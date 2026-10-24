import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { opencodeProvider } from '@earendil-works/pi-ai/providers/opencode';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import {
    CONNECTION_PROVIDERS,
    ConnectionError,
    ConnectionManager,
    isConnectionProvider,
    type ConnectionProvider,
} from './auth/connection-manager.js';
import { LocalModelServer, type LocalModelView } from './auth/local-model.js';
import { loadConfig, type ServerConfig } from './config.js';
import {
    CONTRACT_VERSION,
    MAX_REPORTED_ISSUES,
    fingerprint,
    isTerminal,
    validate,
    type CancelRequest,
    type ConnectionCallbackRequest,
    type ConnectionKeyRequest,
    type ConnectionLoginRequest,
    type ConnectionTestRequest,
    type ContractName,
    type Issue,
    type RunEvent,
    type RunRequest,
} from './contracts.js';
import { readBoundedBody } from './http/body.js';
import { readSignatureHeaders, signatureMatches, type SignatureFailure } from './http/service-auth.js';
import { runLive } from './runtime/live-run.js';
import type { RunExecution } from './runtime/run-execution.js';
import { RunRegistry, type TrackedStatus } from './runtime/run-registry.js';
import { runSimulation } from './simulation/simulated-run.js';

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const CANCEL_PATH = new RegExp(`^/internal/runs/${UUID}/cancel$`);
const EVENTS_PATH = new RegExp(`^/internal/runs/${UUID}/events$`);
const CONNECTION_PATH = new RegExp(`^/internal/connections/${UUID}(/login|/login/callback|/key|/test)?$`);
const CONNECTION_ROUTES = new Set([
    'GET /',
    'DELETE /',
    'POST /login',
    'GET /login',
    'DELETE /login',
    'POST /login/callback',
    'PUT /key',
    'POST /test',
]);
const SEQUENCE = /^(0|[1-9][0-9]{0,6})$/;
const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;

// Runs use the deterministic development provider, or since task 3.2 a connected provider's
// model through the run's own connection. No tool registry exists until task 3.3, so no
// capability can be enforced yet.
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

export interface ServerDependencies {
    /** Provider sign-ins; defaults to the real providers when a credential key is configured. */
    connections?: ConnectionManager | null;
    /** The local model server; defaults to LOCAL_LLM_URL when set. */
    local?: LocalModelServer | null;
}

// Loading both libraries proves the selected Pi packages work in this runtime. Run admission
// is authenticated and validated here; admitted runs execute the deterministic simulation or a
// Pi Agent on the run's connection (runtime/live-run.ts).
export function createServer(config: ServerConfig = loadConfig(), dependencies: ServerDependencies = {}) {
    if (typeof Agent !== 'function' || typeof createModels !== 'function') {
        throw new Error('The installed Pi packages do not expose the expected API.');
    }

    const registry = new RunRegistry(config.maxTrackedRuns, config.trackedRunTtlMs, config.now, config.maxEventsPerRun);
    const local =
        dependencies.local !== undefined
            ? dependencies.local
            : config.localModel === null
              ? null
              : new LocalModelServer(config.localModel, config.now);
    const connections =
        dependencies.connections !== undefined
            ? dependencies.connections
            : config.credentialKey === null
              ? null
              : new ConnectionManager({
                    dataDirectory: config.dataDirectory,
                    key: config.credentialKey,
                    providers: { openai: openaiProvider, opencode: opencodeProvider, 'opencode-go': opencodeGoProvider },
                    local,
                    loginTimeoutMs: config.loginTimeoutMs,
                    testTimeoutMs: config.connectionTestTimeoutMs,
                    now: config.now,
                    log: config.log,
                });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        const target = request.url ?? '';

        if (request.method === 'GET' && target === '/internal/health') {
            sendJson(response, 200, {
                status: 'ok',
                service: 'agent',
                providerAuth: connections === null ? 'not_configured' : 'configured',
                requestAuth: config.requestSigningKey === null ? 'not_configured' : 'configured',
                simulation: config.simulationEnabled ? 'enabled' : 'disabled',
            });
            return;
        }

        const url = new URL(target, 'http://engine.internal');
        const cancelPath = request.method === 'POST' ? CANCEL_PATH.exec(target) : null;
        const eventsPath = request.method === 'GET' ? EVENTS_PATH.exec(url.pathname) : null;
        const connectionPath = CONNECTION_PATH.exec(url.pathname);
        try {
            if (request.method === 'POST' && target === '/internal/runs') {
                admitRun(response, await readContract<RunRequest>(request, 'runRequest'));
            } else if (cancelPath !== null) {
                cancelRun(response, cancelPath[1]!, await readContract<CancelRequest>(request, 'cancelRequest'));
            } else if (eventsPath !== null) {
                await authenticate(request);
                streamEvents(response, eventsPath[1]!, url.searchParams);
            } else if (connectionPath !== null) {
                await routeConnection(request, response, connectionPath[1]!, connectionPath[2] ?? '', url.searchParams);
            } else if (request.method === 'GET' && target === '/internal/local-model') {
                await authenticate(request);
                sendJson(response, 200, { contractVersion: CONTRACT_VERSION, ...(await localModelView()) });
            } else {
                throw new HttpError(404, 'not_found', 'Not found');
            }
        } catch (error) {
            if (error instanceof ConnectionError) {
                sendError(response, new HttpError(error.status, error.code, error.message));
                return;
            }
            if (!(error instanceof HttpError)) {
                throw error;
            }
            sendError(response, error);
        }
    }

    /** The administrator's local model server as users see it; contacts only that configured server. */
    async function localModelView(): Promise<LocalModelView> {
        if (local === null) {
            return { configured: false, name: null, baseUrl: null, reachable: false, models: [], error: null };
        }

        await local.refresh();

        return local.view();
    }

    /**
     * Sign-in endpoints for one Laravel provider connection. Every answer is non-secret state;
     * tokens stay in the engine's encrypted store.
     */
    async function routeConnection(
        request: IncomingMessage,
        response: ServerResponse,
        connectionId: string,
        action: string,
        query: URLSearchParams,
    ): Promise<void> {
        const route = `${request.method ?? ''} ${action === '' ? '/' : action}`;
        if (!CONNECTION_ROUTES.has(route)) {
            throw new HttpError(404, 'not_found', 'Not found');
        }

        const body = await authenticate(request);
        if (connections === null) {
            throw new HttpError(503, 'credential_store_not_configured', 'The engine has no credential key configured.');
        }

        const reply = (payload: object): void => sendJson(response, 200, { contractVersion: CONTRACT_VERSION, connectionId, ...payload });

        switch (route) {
            case 'GET /':
                reply(await connections.status(connectionId, providerParameter(query)));
                return;
            case 'DELETE /':
                reply(await connections.disconnect(connectionId, providerParameter(query)));
                return;
            case 'POST /login': {
                const login = parseContract<ConnectionLoginRequest>(request, body, 'connectionLoginRequest');
                reply(await connections.startLogin(connectionId, login.provider, login.agentName));
                return;
            }
            case 'GET /login':
                reply(connections.loginView(connectionId));
                return;
            case 'DELETE /login':
                reply(await connections.cancelLogin(connectionId));
                return;
            case 'POST /login/callback': {
                const callback = parseContract<ConnectionCallbackRequest>(request, body, 'connectionCallbackRequest');
                reply(await connections.completeLogin(connectionId, callback.redirectUrl));
                return;
            }
            case 'PUT /key': {
                // The key is stored encrypted and never echoed, logged or returned.
                const key = parseContract<ConnectionKeyRequest>(request, body, 'connectionKeyRequest');
                reply(await connections.saveKey(connectionId, key.provider, key.apiKey));
                return;
            }
            case 'POST /test': {
                const check = parseContract<ConnectionTestRequest>(request, body, 'connectionTestRequest');
                reply(await connections.test(connectionId, check.provider, check.modelId));
            }
        }
    }

    /** Checks headers before reading the bounded body, then verifies the signature over its exact bytes. */
    async function authenticate(request: IncomingMessage): Promise<Buffer> {
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

        return body;
    }

    /** Authenticates, then parses the body and validates it against `contract`. */
    async function readContract<T>(request: IncomingMessage, contract: ContractName): Promise<T> {
        return parseContract<T>(request, await authenticate(request), contract);
    }

    /** Parses an authenticated body and validates it against `contract`. */
    function parseContract<T>(request: IncomingMessage, body: Buffer, contract: ContractName): T {
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
        admitModel(run);

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
        if (admission.outcome === 'accepted') {
            // Execution continues without a subscriber; readers replay its events later.
            execute(run, admission.execution);
        }

        sendAcknowledgement(response, run.runId, admission.status, admission.outcome === 'duplicate');
    }

    /**
     * The simulation runs only when enabled. A provider model runs only on the run's own
     * connection: the credential is looked up by that ID and never comes from the request.
     */
    function admitModel(run: RunRequest): void {
        const { provider, id } = run.model;
        const unavailable = new HttpError(422, 'model_unavailable', `No verified provider can run ${provider}/${id}.`);

        if (provider === SIMULATED_PROVIDER) {
            if (!config.simulationEnabled) {
                throw unavailable;
            }

            return;
        }
        if (!isConnectionProvider(provider) || connections === null || (provider === 'local' && local === null)) {
            throw unavailable;
        }
        if (run.connectionId === null) {
            throw new HttpError(422, 'connection_required', `${provider}/${id} needs the run's own provider connection.`);
        }
    }

    function execute(run: RunRequest, execution: RunExecution): void {
        const work =
            run.model.provider === SIMULATED_PROVIDER || connections === null
                ? runSimulation(run, execution, { chunkDelayMs: config.simulationChunkDelayMs, now: config.now })
                : runLive(run, execution, { connections, log: config.log });

        work.catch((error: unknown) => {
            config.log(`Run ${run.runId} failed: ${error instanceof Error ? error.message : String(error)}`);
            execution.emit('run.failed', { code: 'internal_error', message: 'The engine could not complete the run.' });
        });
    }

    /** Replays events after `after`, then follows the run until its terminal event (NDJSON). */
    function streamEvents(response: ServerResponse, runId: string, query: URLSearchParams): void {
        const after = query.get('after') ?? '0';
        if (!SEQUENCE.test(after)) {
            throw invalidPayload([{ path: '/after', message: 'must be a non-negative event sequence' }]);
        }

        const execution = registry.execution(runId);
        if (execution === null) {
            throw new HttpError(404, 'run_not_found', 'The engine is not tracking this run.');
        }

        response.setHeader('Content-Type', 'application/x-ndjson');
        response.writeHead(200);
        const write = (event: RunEvent): void => {
            response.write(`${JSON.stringify(event)}\n`);
        };

        for (const event of execution.after(Number(after))) {
            write(event);
        }
        if (execution.terminal) {
            response.end();
            return;
        }

        const heartbeat = setInterval(() => response.write('\n'), config.streamHeartbeatMs);
        const unsubscribe = execution.subscribe((event) => {
            write(event);
            if (isTerminal(event.type)) {
                stop();
                response.end();
            }
        });
        function stop(): void {
            clearInterval(heartbeat);
            unsubscribe();
        }
        // The request has already been read; only the response reports a disconnecting reader.
        response.on('close', stop);
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

function providerParameter(query: URLSearchParams): ConnectionProvider {
    const provider = query.get('provider');
    if (!isConnectionProvider(provider)) {
        throw invalidPayload([{ path: '/provider', message: `must be one of ${Object.keys(CONNECTION_PROVIDERS).join(', ')}` }]);
    }

    return provider;
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
