import type { Static, TSchema } from 'typebox';
import { lookupReference } from './lookup-reference.js';

/** Where a tool result came from, kept apart from the text the model reads. */
export interface ToolSource {
    evidenceId: string;
    title: string;
    locator: string;
    /** ISO date the source was last checked. */
    checkedAt: string;
}

export interface ToolOutput {
    /** Model-facing result text. */
    text: string;
    sources: ToolSource[];
}

/**
 * A tool the engine may offer a model. Reviewed static registration: nothing is loaded from
 * folders or requests. Write effects need their own authorization and confirmation design first.
 */
export interface ToolDefinition<TParameters extends TSchema = TSchema> {
    /** Stable name the model calls. */
    name: string;
    label: string;
    description: string;
    parameters: TParameters;
    /** The run capability that permits this tool; Laravel's snapshot decides who has it. */
    capability: string;
    effect: 'read';
    timeoutMs: number;
    /** Longest result text, in characters, passed back to the model. */
    maxResultLength: number;
    run(args: Static<TParameters>, signal: AbortSignal): Promise<ToolOutput>;
}

export const TOOLS: readonly ToolDefinition[] = [lookupReference];

/** Capabilities the engine can enforce; a run requesting any other is refused at admission. */
export const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set(TOOLS.map((tool) => tool.capability));
