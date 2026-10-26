import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai';
import type { ConnectionManager, ConnectionProvider, RunModel } from '../auth/connection-manager.js';
import type { RunMessage, RunRequest } from '../contracts.js';
import { safeSlice } from '../text.js';
import { ToolExecutor } from '../tools/executor.js';
import type { ToolDefinition } from '../tools/registry.js';
import type { RunExecution } from './run-execution.js';

/** The contract's bounds for one `assistant.delta` and for `assistant.final` text. */
const MAX_DELTA_LENGTH = 16_384;
const MAX_FINAL_LENGTH = 200_000;
/** Per-request token ceiling; the character budget below also bounds text across model rounds. */
const MAX_OUTPUT_TOKENS = 32_000;
/** Streamed text is passed on in batches, so even a run that uses its whole deadline stays far below the per-run event limit. */
const DELTA_BUDGET = 1_500;
const MIN_FLUSH_INTERVAL_MS = 100;
const MAX_ERROR_LENGTH = 500;

const SYSTEM_PROMPT =
    'You are a helpful assistant in a chat application. Answer clearly and concisely, and use Markdown when it helps readability.';
const TOOLS_PROMPT =
    ' When a question concerns the organisation\'s reference records, look them up with your tools rather than guessing, cite the codes you used, and say plainly when nothing matches.';
/** Separates the text of consecutive assistant turns, for example before and after a lookup. */
const TURN_SEPARATOR = '\n\n';

export interface LiveRunOptions {
    connections: ConnectionManager;
    log: (message: string) => void;
    /** Trusted engine definitions; never supplied by a run request. Defaults to the static registry. */
    toolRegistry?: readonly ToolDefinition[];
}

/**
 * Answers one admitted run with a fresh Pi Agent on the run's own connection and model, and maps
 * its stream to contract events. Every path ends with exactly one terminal event.
 */
export async function runLive(run: RunRequest, execution: RunExecution, options: LiveRunOptions): Promise<void> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), run.limits.runDeadlineMs);
    const signal = AbortSignal.any([execution.signal, deadline.signal]);
    const stopped = (): boolean => {
        if (execution.signal.aborted) {
            execution.emit('run.cancelled');
        } else if (deadline.signal.aborted) {
            execution.emit('run.failed', { code: 'deadline_exceeded', message: 'The run exceeded its time limit.' });
        }

        return signal.aborted;
    };

    execution.emit('run.started');
    execution.emit('run.progress', { stage: 'preparing' });

    try {
        if (stopped()) {
            return;
        }
        const prepared = await options.connections.runModel(
            run.connectionId ?? '',
            run.model.provider as ConnectionProvider,
            run.model.id,
            signal,
        );
        if (stopped()) {
            return;
        }
        if (!('model' in prepared)) {
            execution.emit('run.failed', { code: prepared.code, message: shorten(prepared.message) });

            return;
        }

        const { last, text, outputLimitExceeded } = await answerWith(prepared, run, execution, signal, options.toolRegistry);
        if (stopped()) {
            return;
        }
        if (outputLimitExceeded || text.length > MAX_FINAL_LENGTH) {
            execution.emit('run.failed', { code: 'output_limit_exceeded', message: 'The reply exceeded its size limit. Ask for a shorter answer.' });

            return;
        }
        if (last.stopReason === 'error') {
            options.log(`Run ${run.runId} provider error: ${last.errorMessage ?? 'unknown'}`);
            execution.emit('run.failed', { code: 'provider_error', message: providerMessage(last.errorMessage) });

            return;
        }

        if (text.trim() === '') {
            execution.emit('run.failed', { code: 'empty_reply', message: 'The model returned no text. Try again.' });

            return;
        }

        execution.emit('assistant.final', { text });
        execution.emit('run.completed');
    } catch (error) {
        // An adapter may reject on abort instead of returning an aborted message.
        if (!stopped()) {
            throw error;
        }
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Runs the agent on the conversation and streams its text. Resolves to the last assistant message
 * (how the run ended) and the text of every assistant turn, which is what the deltas added up to.
 */
async function answerWith(
    { models, model }: RunModel,
    run: RunRequest,
    execution: RunExecution,
    signal: AbortSignal,
    toolRegistry?: readonly ToolDefinition[],
): Promise<{ last: AssistantMessage; text: string; outputLimitExceeded: boolean }> {
    let stage: 'preparing' | 'retrieving' | 'answering' = 'preparing';
    const enter = (next: typeof stage): void => {
        if (stage !== next) {
            stage = next;
            execution.emit('run.progress', { stage });
        }
    };

    const tools = new ToolExecutor(run.capabilities, run.limits.maxToolCalls, execution, () => enter('retrieving'), toolRegistry);
    // A tool result needs a further model round to be used, so a single round offers no tools.
    const offerTools = tools.available && run.limits.maxModelRounds > 1;
    let requests = 0;
    const agent = new Agent({
        initialState: {
            systemPrompt: offerTools ? SYSTEM_PROMPT + TOOLS_PROMPT : SYSTEM_PROMPT,
            model,
            thinkingLevel: thinkingLevel(model, run),
            messages: run.messages.map((message) => toAgentMessage(message, model)),
            tools: offerTools ? tools.agentTools() : [],
        },
        streamFn: (requestModel, context, streamOptions) =>
            models.streamSimple(requestModel, context, {
                ...streamOptions,
                maxTokens: Math.min(requestModel.maxTokens, MAX_OUTPUT_TOKENS),
            }),
        beforeToolCall: async (context, toolSignal) => tools.beforeToolCall(context, toolSignal),
        // Before the last permitted round, or once the tool budget is used up, the tools are
        // withdrawn; Pi tells the model, which then has to answer with what it has.
        prepareNextTurnWithContext: ({ context }) =>
            requests + 1 >= run.limits.maxModelRounds || !tools.available ? { context: { ...context, tools: [] } } : undefined,
        prepareRequest: () => {
            signal.throwIfAborted();
            requests += 1;
        },
        // No request beyond the run's model rounds, even if the last one asked for a tool anyway.
        finishTurn: () => (requests >= run.limits.maxModelRounds ? { action: 'end' } : undefined),
        toolExecution: 'sequential',
        // Cache-aware providers keep a conversation's prefix warm; OpenCode routes by session.
        sessionId: run.conversationId,
    });

    const deltas = new DeltaBuffer(execution, Math.max(MIN_FLUSH_INTERVAL_MS, Math.ceil(run.limits.runDeadlineMs / DELTA_BUDGET)), signal);
    const texts: string[] = [];
    let last: AssistantMessage | null = null;
    let current = '';
    let streamedLength = 0;
    let outputLimitExceeded = false;

    agent.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
            if (outputLimitExceeded || signal.aborted) {
                return;
            }
            const delta = event.assistantMessageEvent.delta;
            if (delta === '') {
                return;
            }
            const separator = current === '' && texts.length > 0 ? TURN_SEPARATOR : '';
            if (streamedLength + separator.length + delta.length > MAX_FINAL_LENGTH) {
                outputLimitExceeded = true;
                agent.abort();

                return;
            }

            enter('answering');
            streamedLength += separator.length + delta.length;
            current += delta;
            deltas.add(separator + delta);
        }
        if (event.type === 'message_end' && event.message.role === 'assistant') {
            last = event.message;
            const text = textOf(event.message);
            if (text !== '') {
                texts.push(text);
            }
            current = '';
        }
        if (event.type === 'tool_execution_end') {
            tools.finish(event.toolCallId, event.toolName, event.isError);
        }
    });

    const abort = (): void => agent.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
        await agent.continue();
    } finally {
        signal.removeEventListener('abort', abort);
        deltas.close(!signal.aborted);
    }

    return {
        last: last ?? { ...assistantMessage(model, ''), stopReason: 'error', errorMessage: 'The model returned no answer.' },
        text: texts.join(TURN_SEPARATOR),
        outputLimitExceeded,
    };
}

/**
 * Collects streamed text and emits it at most once per interval, in pieces within the contract's
 * delta limit. Nothing is emitted after the run has stopped.
 */
class DeltaBuffer {
    private pending = '';
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly execution: RunExecution,
        private readonly intervalMs: number,
        private readonly signal: AbortSignal,
    ) {}

    add(text: string): void {
        if (this.signal.aborted) {
            return;
        }
        this.pending += text;
        this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
    }

    /** Stops the timer; the remaining text is sent only when the answer ended normally. */
    close(send: boolean): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (send) {
            this.flush();
        }
        this.pending = '';
    }

    private flush(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = null;
        let rest = this.pending;
        this.pending = '';
        while (rest !== '' && !this.signal.aborted) {
            const piece = safeSlice(rest, MAX_DELTA_LENGTH);
            this.execution.emit('assistant.delta', { text: piece });
            rest = rest.slice(piece.length);
        }
    }
}

/** The requested effort for models that reason; others run without it. */
function thinkingLevel(model: Model<Api>, run: RunRequest): ThinkingLevel {
    return model.reasoning ? (run.model.reasoning ?? 'medium') : 'off';
}

/** Saved history as Pi messages. Earlier replies are plain text, so any model can read them. */
function toAgentMessage(message: RunMessage, model: Model<Api>): AgentMessage {
    return message.role === 'user'
        ? { role: 'user', content: message.content, timestamp: 0 }
        : assistantMessage(model, message.content);
}

function assistantMessage(model: Model<Api>, text: string): AssistantMessage {
    return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: 0,
    };
}

function textOf(message: AssistantMessage): string {
    return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}

/** A provider's error for the reader; a network failure gets a clearer explanation. */
function providerMessage(errorMessage: string | undefined): string {
    if (errorMessage === undefined || errorMessage.trim() === '') {
        return 'The provider returned an error.';
    }
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|CERT_/i.test(errorMessage)) {
        return shorten(`The engine could not reach the provider (${errorMessage}). Check the network, proxy or security software.`);
    }

    return shorten(errorMessage);
}

function shorten(message: string): string {
    return message.length > MAX_ERROR_LENGTH ? `${safeSlice(message, MAX_ERROR_LENGTH - 1)}…` : message;
}
