import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { RunRequest } from '../contracts.js';

const MAX_OUTPUT_TOKENS = 32_000;
const ESTIMATE_OVERHEAD = 512;

export class ContextBudgetError extends Error {
    constructor() {
        super('This question and its required context exceed the selected model\'s budget. Send a shorter question.');
    }
}

/** Reserve the whole allowed answer and provider overhead inside the selected model's window. */
export function tokenBudget(model: Model<Api>, limits: RunRequest['limits']): { input: number; output: number } {
    if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1 || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1) {
        throw new ContextBudgetError();
    }

    const output = Math.min(limits.maxOutputTokens, model.maxTokens, MAX_OUTPUT_TOKENS, Math.floor(model.contextWindow / 2));
    const margin = Math.max(256, Math.ceil(model.contextWindow * 0.02));
    const input = Math.min(limits.maxInputTokens, model.contextWindow - output - margin);
    if (input < 1 || output < 1) {
        throw new ContextBudgetError();
    }

    return { input, output };
}

/**
 * UTF-8 bytes of the serialized request are a conservative token proxy across model families.
 * The estimate includes the system prompt, tool schemas and message framing. It intentionally
 * sacrifices some usable window to avoid sending an oversized request with an unknown tokenizer.
 */
export function estimatedInputTokens(context: unknown): number {
    return Buffer.byteLength(JSON.stringify(context), 'utf8') + ESTIMATE_OVERHEAD;
}

/** Keep the newest complete messages, never shortening a canonical message or losing the question. */
export function selectHistory(
    history: AgentMessage[],
    systemPrompt: string,
    tools: unknown,
    inputBudget: number,
): AgentMessage[] {
    const selected = [...history];
    while (selected.length > 0 && estimatedInputTokens({
        messages: [{ role: 'system', content: systemPrompt }, ...selected],
        tools,
    }) > inputBudget) {
        if (selected.length === 1) {
            throw new ContextBudgetError();
        }
        selected.shift();
    }

    return selected;
}
