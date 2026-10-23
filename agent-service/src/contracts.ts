import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Schema from 'typebox/schema';

export const CONTRACT_VERSION = 1;

// The repository's contracts/ directory is the single source of truth. Locally it sits two
// levels above src/ or dist/; Compose mounts it at /contracts, the same relative location.
const contractsDirectory = new URL(`../../contracts/v${CONTRACT_VERSION}/`, import.meta.url);
export const MAX_REPORTED_ISSUES = 10;

const validators = {
    runRequest: compile('run-request.schema.json'),
    cancelRequest: compile('cancel-request.schema.json'),
    runAcknowledgement: compile('run-acknowledgement.schema.json'),
    runEvent: compile('run-event.schema.json'),
    error: compile('error.schema.json'),
    connectionLoginRequest: compile('connection-login-request.schema.json'),
    connectionCallbackRequest: compile('connection-callback-request.schema.json'),
    connectionTestRequest: compile('connection-test-request.schema.json'),
    connectionLogin: compile('connection-login.schema.json'),
    connectionStatus: compile('connection-status.schema.json'),
    connectionTestResult: compile('connection-test-result.schema.json'),
};

export type ContractName = keyof typeof validators;

export interface Issue {
    path: string;
    message: string;
}

export interface RunMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface RunRequest {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    conversationId: string;
    userId: string;
    profile: { id: string; version: number };
    model: { provider: string; id: string };
    connectionId: string | null;
    capabilities: string[];
    messages: RunMessage[];
    limits: { maxModelRounds: number; maxToolCalls: number; runDeadlineMs: number };
}

export interface CancelRequest {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
}

export interface ConnectionLoginRequest {
    contractVersion: typeof CONTRACT_VERSION;
    provider: 'openai';
    agentName: string;
}

export interface ConnectionCallbackRequest {
    contractVersion: typeof CONTRACT_VERSION;
    redirectUrl: string;
}

export interface ConnectionTestRequest {
    contractVersion: typeof CONTRACT_VERSION;
    provider: 'openai';
    modelId: string;
}

export const TERMINAL_EVENT_TYPES = ['run.completed', 'run.failed', 'run.cancelled'] as const;

export type RunEventType =
    | 'run.started'
    | 'run.progress'
    | 'assistant.delta'
    | 'assistant.final'
    | (typeof TERMINAL_EVENT_TYPES)[number];

export interface RunEvent {
    contractVersion: typeof CONTRACT_VERSION;
    runId: string;
    sequence: number;
    type: RunEventType;
    data: Record<string, unknown>;
}

export function isTerminal(type: RunEventType): boolean {
    return (TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
}

/** Returns bounded, de-duplicated schema violations; an empty list means the value is valid. */
export function validate(contract: ContractName, value: unknown): Issue[] {
    const [valid, errors] = validators[contract].Errors(value);
    if (valid) {
        return [];
    }

    const issues = new Map<string, Issue>();
    for (const error of errors) {
        const issue = { path: error.instancePath || '/', message: error.message };
        issues.set(`${issue.path}\n${issue.message}`, issue);
    }

    return [...issues.values()].slice(0, MAX_REPORTED_ISSUES);
}

/** Order-independent hash used to recognize an identical resubmission of the same run. */
export function fingerprint(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

function compile(file: string) {
    const schema = JSON.parse(readFileSync(new URL(file, contractsDirectory), 'utf8')) as Schema.XSchema;

    return Schema.Compile(schema);
}
