import type { AgentTool, AgentToolResult, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import { Value } from 'typebox/value';
import type { RunExecution } from '../runtime/run-execution.js';
import { safeSlice } from '../text.js';
import { TOOLS, type ToolDefinition } from './registry.js';

export type ToolOutcome = 'ok' | 'blocked' | 'invalid_arguments' | 'failed' | 'timeout';

interface Settled {
    outcome: ToolOutcome;
    message: string | null;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_NAME_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const SHORTENED = '\n[Result shortened to fit the tool size limit.]';

/** The provider's call ID as the events contract accepts it: printable ASCII, bounded. */
const eventId = (toolCallId: string): string => toolCallId.replace(/[^\x21-\x7e]/g, '_').slice(0, MAX_ID_LENGTH) || 'unknown';

/**
 * The tool boundary of one run. It offers only the tools the run's capability snapshot permits,
 * checks permission, duplicates and the run's tool budget before each call, checks the arguments
 * again when the call runs, and bounds every call with a timeout and a result-size cap. Every
 * call ends with an explicit outcome, reported as run events and to the model.
 */
export class ToolExecutor {
    private readonly tools: ToolDefinition[];
    private readonly handled = new Set<string>();
    private readonly settled = new Map<string, Settled>();
    private reserved = 0;

    constructor(
        private readonly capabilities: readonly string[],
        private readonly maxToolCalls: number,
        private readonly execution: RunExecution,
        /** Called when a permitted call starts running. */
        private readonly onStart: () => void = () => {},
        registry: readonly ToolDefinition[] = TOOLS,
    ) {
        this.tools = registry.filter((tool) => capabilities.includes(tool.capability));
    }

    /** Whether another call may still run in this reply. */
    get available(): boolean {
        return this.tools.length > 0 && this.reserved < this.maxToolCalls;
    }

    /** The toolbox for the model; empty when nothing is permitted. */
    agentTools(): AgentTool[] {
        return this.tools.map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            parameters: tool.parameters,
            executionMode: 'sequential',
            execute: (toolCallId, args, signal) => this.execute(tool, toolCallId, args, signal),
        }));
    }

    /** Runs after Pi has validated the arguments against the schema, before the tool executes. */
    beforeToolCall({ toolCall }: BeforeToolCallContext): BeforeToolCallResult | undefined {
        const tool = this.permitted(toolCall.name);
        const refuse = (message: string): BeforeToolCallResult => {
            this.settled.set(toolCall.id, { outcome: 'blocked', message });

            return { block: true, reason: message };
        };

        if (tool === undefined) {
            return refuse(`The tool ${toolCall.name} is not available in this conversation.`);
        }
        if (this.handled.has(toolCall.id)) {
            return refuse('This tool call was already handled.');
        }
        if (this.reserved >= this.maxToolCalls) {
            return refuse('No more lookups are allowed for this reply. Answer with what you already have.');
        }

        this.handled.add(toolCall.id);
        this.reserved += 1;

        return undefined;
    }

    /**
     * Reports how a call ended. A call Pi refused before the checks above named a tool that is not
     * offered, or had arguments that do not match the tool's schema.
     */
    finish(toolCallId: string, name: string, isError: boolean): void {
        const refused: ToolOutcome = this.permitted(name) === undefined ? 'blocked' : 'invalid_arguments';
        // Pi's validation errors include the received arguments. Keep them in the model's
        // tool result; browser events carry only a fixed explanation and the outcome.
        const refusalMessage = refused === 'blocked'
            ? 'The requested tool is not available in this conversation.'
            : 'The tool arguments do not match its schema.';
        const settled = this.settled.get(toolCallId) ?? {
            outcome: isError ? refused : 'ok',
            message: isError ? refusalMessage : null,
        };

        this.execution.emit('tool.finished', {
            toolCallId: eventId(toolCallId),
            // The model chose this name; it may not be a tool at all.
            name: safeSlice(name, MAX_NAME_LENGTH) || 'unknown',
            outcome: settled.outcome,
            message: settled.message === null || settled.message === '' ? null : shorten(settled.message),
        });
    }

    private permitted(name: string): ToolDefinition | undefined {
        return this.tools.find((tool) => tool.name === name && this.capabilities.includes(tool.capability));
    }

    private async execute(tool: ToolDefinition, toolCallId: string, args: unknown, signal?: AbortSignal): Promise<AgentToolResult<{ outcome: ToolOutcome }>> {
        const result = (outcome: ToolOutcome, text: string): AgentToolResult<{ outcome: ToolOutcome }> => {
            this.settled.set(toolCallId, { outcome, message: outcome === 'ok' ? null : text });

            return { content: [{ type: 'text', text }], details: { outcome }, ...(outcome === 'ok' ? {} : { isError: true }) };
        };

        // Checked again where the call runs, not only by Pi when the call was prepared.
        if (this.permitted(tool.name) === undefined) {
            return result('blocked', `The tool ${tool.name} is not available in this conversation.`);
        }
        if (!Value.Check(tool.parameters, args)) {
            return result('invalid_arguments', `The arguments for ${tool.name} do not match its schema.`);
        }

        this.onStart();
        this.execution.emit('tool.started', { toolCallId: eventId(toolCallId), name: tool.name });
        const timeout = AbortSignal.timeout(tool.timeoutMs);
        const bounded = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

        try {
            const output = await untilAborted(tool.run(args, bounded), bounded);
            for (const source of output.sources) {
                this.execution.emit('source.added', { toolCallId: eventId(toolCallId), ...source });
            }

            // The notice is part of the returned text, so it also consumes the size budget.
            const notice = safeSlice(SHORTENED, tool.maxResultLength);
            const text = output.text.length > tool.maxResultLength
                ? `${safeSlice(output.text, tool.maxResultLength - notice.length)}${notice}`
                : output.text;

            return result('ok', text);
        } catch {
            return timeout.aborted && signal?.aborted !== true
                ? result('timeout', `${tool.name} did not finish within ${tool.timeoutMs / 1000} seconds.`)
                : result('failed', `${tool.name} could not complete.`);
        }
    }
}

/** Settles with the work, or rejects as soon as the signal aborts even if the work ignores it. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }

    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function shorten(message: string): string {
    return message.length > MAX_MESSAGE_LENGTH ? `${safeSlice(message, MAX_MESSAGE_LENGTH - 1)}…` : message;
}
