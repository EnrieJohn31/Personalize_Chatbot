import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { loadConfig, type ServerConfig } from './config.js';
import {
    CONTRACT_VERSION,
    MAX_REPORTED_ISSUES,
    fingerprint,
    validate,
    type CancelRequest,
    type ContractName,
    type Issue,
    type RunRequest,
} from './contracts.js';
import { readBoundedBody } from './http/body.js';
import { readSignatureHeaders, signatureMatches, type SignatureFailure } from './http/service-auth.js';
import { RunRegistry, type TrackedStatus } from './runtime/run-registry.js';

const CANCEL_PATH = /^\/internal\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/cancel$/;
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;

// No provider login or tool registry exists yet (tasks 3.1–3.3). Until then only the
// deterministic development provider is admitted, and no capability can be enforced.
const SIMULATED_PROVIDER = 'simulated';
const SUPPORTED_CAPABILITIES = new Set<string>();

class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details: Issue[] = [],
    ) {
        super(message);
    }
}

// Loading both libraries proves the selected Pi packages work in this runtime. Run admission
// is authenticated and validated here; model execution is intentionally added in Phase 3.
export function createServer(config: ServerConfig = loadConfig()) {
    if (typeof Agent !== 'function' || typeof createModels !== 'function') {
        throw new Error('The installed Pi packages do not expose the expected API.');
    }

    const registry = new RunRegistry(config.maxTrackedRuns, config.trackedRunTtlMs, config.now);

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        const target = request.url ?? '';

        if (request.method === 'GET' && target === '/internal/health') {
            sendJson(response, 200, {
                status: 'ok',
                service: 'agent',
                providerAuth: 'not_configured',
                requestAuth: config.requestSigningKey === null ? 'not_configured' : 'configured',
                simulation: config.simulationEnabled ? 'enabled' : 'disabled',
            });
            return;
        }

        const cancelPath = request.method === 'POST' ? CANCEL_PATH.exec(target) : null;
        try {
            if (request.method === 'POST' && target === '/internal/runs') {
                admitRun(response, await readContract<RunRequest>(request, 'runRequest'));
            } else if (cancelPath !== null) {
                cancelRun(response, cancelPath[1]!, await readContract<CancelRequest>(request, 'cancelRequest'));
            } else {
                throw new HttpError(404, 'not_found', 'Not found');
            }
        } catch (error) {
            if (!(error instanceof HttpError)) {
                throw error;
            }
            sendError(response, error);
        }
    }

    /** Authenticates before reading the body, then parses and validates it against `contract`. */
    async function readContract<T>(request: IncomingMessage, contract: ContractName): Promise<T> {
        if (config.requestSigningKey === null) {
            throw new HttpError(503, 'request_auth_not_configured', 'The engine has no request signing key configured.');
        }

        const signature = readSignatureHeaders(request.headers, config.now(), config.signatureToleranceSeconds);
        if (typeof signature === 'string') {
            throw authenticationFailed(signature);
        }

        const body = await readBoundedBody(request, config.maxRequestBytes);
        if (body === null) {
            throw new HttpError(413, 'payload_too_large', `Request bodies are limited to ${config.maxRequestBytes} bytes.`);
        }
        if (!signatureMatches(config.requestSigningKey, signature, request.method ?? '', request.url ?? '', body)) {
            throw authenticationFailed('mismatch');
        }
        if (!JSON_CONTENT_TYPE.test(request.headers['content-type'] ?? '')) {
            throw new HttpError(415, 'unsupported_media_type', 'Send the request as application/json.');
        }

        let payload: unknown;
        try {
            payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        } catch {
            throw new HttpError(400, 'invalid_json', 'The request body is not valid UTF-8 JSON.');
        }

        if (isRecord(payload) && payload.contractVersion !== CONTRACT_VERSION) {
            throw new HttpError(422, 'unsupported_contract_version', `This engine accepts contract version ${CONTRACT_VERSION}.`, [
                { path: '/contractVersion', message: `must be ${CONTRACT_VERSION}` },
            ]);
        }

        const issues = validate(contract, payload);
        if (issues.length > 0) {
            throw invalidPayload(issues);
        }

        return payload as T;
    }

    function admitRun(response: ServerResponse, run: RunRequest): void {
        if (run.messages[run.messages.length - 1]?.role !== 'user') {
            throw invalidPayload([{ path: '/messages', message: 'the final message must have role user' }]);
        }
        if (new Set(run.messages.map((message) => message.id)).size !== run.messages.length) {
            throw invalidPayload([{ path: '/messages', message: 'message IDs must be unique' }]);
        }
        if (run.model.provider !== SIMULATED_PROVIDER || !config.simulationEnabled) {
            throw new HttpError(422, 'model_unavailable', `No verified provider can run ${run.model.provider}/${run.model.id}.`);
        }

        const unsupported = run.capabilities.filter((capability) => !SUPPORTED_CAPABILITIES.has(capability));
        if (unsupported.length > 0) {
            const details = unsupported.slice(0, MAX_REPORTED_ISSUES).map(
                (capability) => ({ path: '/capabilities', message: `unsupported capability ${capability}` }),
            );
            throw new HttpError(422, 'unsupported_capability', 'The engine cannot enforce every requested capability.', details);
        }

        const admission = registry.admit(run.runId, fingerprint(run));
        if (admission.outcome === 'conflict') {
            throw new HttpError(409, 'conflicting_duplicate', 'This run ID was already admitted with a different payload.');
        }
        if (admission.outcome === 'full') {
            throw new HttpError(503, 'capacity_exhausted', 'The engine is tracking its maximum number of runs.');
        }

        sendAcknowledgement(response, run.runId, admission.status, admission.outcome === 'duplicate');
    }

    function cancelRun(response: ServerResponse, pathRunId: string, cancel: CancelRequest): void {
        if (cancel.runId !== pathRunId) {
            throw new HttpError(422, 'run_id_mismatch', 'The body runId must match the path.');
        }

        const result = registry.requestCancel(pathRunId);
        if (result === null) {
            throw new HttpError(404, 'run_not_found', 'The engine is not tracking this run.');
        }

        sendAcknowledgement(response, pathRunId, 'cancel_requested', result.duplicate);
    }

    function authenticationFailed(reason: SignatureFailure): HttpError {
        // The caller receives one generic answer; the specific reason is only logged.
        config.log(`Rejected engine request: authentication_failed (${reason})`);

        return new HttpError(401, 'authentication_failed', 'The request signature is missing, expired or invalid.');
    }

    return createHttpServer(
        { requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 1_000 },
        (request, response) => {
            handle(request, response).catch((error: unknown) => {
                config.log(`Engine request failed: ${error instanceof Error ? error.message : String(error)}`);
                if (response.headersSent) {
                    response.destroy();
                    return;
                }
                sendError(response, new HttpError(500, 'internal_error', 'The engine could not process the request.'));
            });
        },
    );
}

function invalidPayload(details: Issue[]): HttpError {
    return new HttpError(422, 'invalid_payload', `The request does not match contract version ${CONTRACT_VERSION}.`, details);
}

function sendAcknowledgement(response: ServerResponse, runId: string, status: TrackedStatus, duplicate: boolean): void {
    sendJson(response, 202, { contractVersion: CONTRACT_VERSION, runId, status, duplicate });
}

function sendError(response: ServerResponse, error: HttpError): void {
    // Errors can be sent before the body is read, so never reuse the connection afterwards.
    response.setHeader('Connection', 'close');
    sendJson(response, error.status, {
        error: {
            code: error.code,
            message: error.message,
            ...(error.details.length > 0 ? { details: error.details } : {}),
        },
    });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status);
    response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
