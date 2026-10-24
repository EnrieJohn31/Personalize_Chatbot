import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai';
import type { ConnectionManager, ConnectionProvider, RunModel } from '../auth/connection-manager.js';
import type { RunMessage, RunRequest } from '../contracts.js';
import type { RunExecution } from './run-execution.js';

/** The contract's bounds for one `assistant.delta` and for `assistant.final` text. */
const MAX_DELTA_LENGTH = 16_384;
const MAX_FINAL_LENGTH = 200_000;
/** Keeps a complete answer within MAX_FINAL_LENGTH characters for any tokenizer in practice. */
const MAX_OUTPUT_TOKENS = 32_000;
/** Streamed text is passed on in batches, so even a run that uses its whole deadline stays far below the per-run event limit. */
const DELTA_BUDGET = 1_500;
const MIN_FLUSH_INTERVAL_MS = 100;
const MAX_ERROR_LENGTH = 500;

const SYSTEM_PROMPT =
    'You are a helpful assistant in a chat application. Answer clearly and concisely, and use Markdown when it helps readability.';

export interface LiveRunOptions {
    connections: ConnectionManager;
    log: (message: string) => void;
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

        const answer = await answerWith(prepared, run, execution, signal);
        if (stopped()) {
            return;
        }
        if (answer.stopReason === 'error') {
            options.log(`Run ${run.runId} provider error: ${answer.errorMessage ?? 'unknown'}`);
            execution.emit('run.failed', { code: 'provider_error', message: providerMessage(answer.errorMessage) });

            return;
        }

        const text = textOf(answer);
        if (text.trim() === '') {
            execution.emit('run.failed', { code: 'empty_reply', message: 'The model returned no text. Try again.' });

            return;
        }

        execution.emit('assistant.final', { text: text.length > MAX_FINAL_LENGTH ? safeSlice(text, MAX_FINAL_LENGTH) : text });
        execution.emit('run.completed');
    } finally {
        clearTimeout(timer);
    }
}

/** Runs the agent on the conversation and streams its text; resolves to the final assistant message. */
async function answerWith(
    { models, model }: RunModel,
    run: RunRequest,
    execution: RunExecution,
    signal: AbortSignal,
): Promise<AssistantMessage> {
    const agent = new Agent({
        initialState: {
            systemPrompt: SYSTEM_PROMPT,
            model,
            thinkingLevel: thinkingLevel(model, run),
            messages: run.messages.map((message) => toAgentMessage(message, model)),
        },
        streamFn: (requestModel, context, streamOptions) =>
            models.streamSimple(requestModel, context, {
                ...streamOptions,
                maxTokens: Math.min(requestModel.maxTokens, MAX_OUTPUT_TOKENS),
            }),
        // Cache-aware providers keep a conversation's prefix warm; OpenCode routes by session.
        sessionId: run.conversationId,
    });

    const deltas = new DeltaBuffer(execution, Math.max(MIN_FLUSH_INTERVAL_MS, Math.ceil(run.limits.runDeadlineMs / DELTA_BUDGET)));
    let answer: AssistantMessage | null = null;
    let answering = false;

    agent.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
            if (!answering) {
                answering = true;
                execution.emit('run.progress', { stage: 'answering' });
            }
            deltas.add(event.assistantMessageEvent.delta);
        }
        if (event.type === 'message_end' && event.message.role === 'assistant') {
            answer = event.message;
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

    return answer ?? { ...assistantMessage(model, ''), stopReason: 'error', errorMessage: 'The model returned no answer.' };
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
    ) {}

    add(text: string): void {
        this.pending += text;
        this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
    }

    /** Stops the timer; the remaining text is sent only when the answer ended normally. */
    close(send: boolean): void {
        if (send) {
            this.flush();
        }
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private flush(): void {
        this.timer = null;
        let rest = this.pending;
        this.pending = '';
        while (rest !== '') {
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

/** At most `length` UTF-16 units, never splitting a surrogate pair. */
function safeSlice(text: string, length: number): string {
    if (text.length <= length) {
        return text;
    }
    const code = text.charCodeAt(length - 1);

    return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
}
