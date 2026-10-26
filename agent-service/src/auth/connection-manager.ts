import { randomUUID } from 'node:crypto';
import {
    createModels,
    ModelsError,
    type Api,
    type AuthInteraction,
    type Model,
    type MutableModels,
    type Provider,
} from '@earendil-works/pi-ai';
import { CredentialVault, UnreadableCredentialsError } from './credential-vault.js';
import { installationId } from './installation.js';
import type { LocalModelServer } from './local-model.js';
import { RenewalRejections, type RenewalRejection } from './renewal-rejections.js';

/**
 * Providers a user can connect, and how: `oauth` is the provider's own browser sign-in, `api_key`
 * a key the user enters, and `none` the administrator-configured local model server, which every
 * user may use without a credential of their own. Each needs its own verification before it is added.
 */
export const CONNECTION_PROVIDERS = {
    openai: 'oauth',
    opencode: 'api_key',
    'opencode-go': 'api_key',
    local: 'none',
} as const satisfies Record<string, 'oauth' | 'api_key' | 'none'>;
export type ConnectionProvider = keyof typeof CONNECTION_PROVIDERS;
/** Providers whose credentials users store; their Pi providers come from factories. */
export type CredentialProvider = Exclude<ConnectionProvider, 'local'>;

export const isConnectionProvider = (value: unknown): value is ConnectionProvider =>
    typeof value === 'string' && Object.hasOwn(CONNECTION_PROVIDERS, value);

/**
 * Ambient credentials such as OPENAI_API_KEY are never consulted: a missing or failed sign-in
 * must surface as "not connected", not silently switch the user to API billing.
 */
const NO_AMBIENT_AUTH = {
    env: async (): Promise<string | undefined> => undefined,
    fileExists: async (): Promise<boolean> => false,
};

const MAX_MESSAGE_LENGTH = 500;
const TEST_PROMPT = 'Reply with exactly one word: Connected';
const TEST_MAX_TOKENS = 1024;
/** How long a start or a pasted redirect waits for the sign-in to move on before answering. */
const STEP_WAIT_MS = 5_000;

export type LoginState = 'starting' | 'waiting_for_user' | 'exchanging' | 'connected' | 'failed' | 'cancelled';

export interface LoginView {
    provider: ConnectionProvider;
    state: LoginState;
    authUrl: string | null;
    error: string | null;
    expiresAt: number;
}

export interface ConnectionStatus {
    provider: ConnectionProvider;
    /**
     * `unreachable`: the local model server is configured but did not answer. `reauth_required`:
     * the provider refused to renew the stored sign-in; `rejection` says why and when.
     */
    status: 'connected' | 'not_connected' | 'unreadable' | 'unreachable' | 'reauth_required';
    expiresAt: number | null;
    models: string[];
    rejection: RenewalRejection | null;
}

export interface TestFailure {
    code: 'not_connected' | 'reauth_required' | 'credentials_unreadable' | 'provider_error' | 'timeout';
    message: string;
}

/** Why a run cannot use its connection's model; `model_unavailable` when the catalog lacks it. */
export interface RunModelFailure {
    code: TestFailure['code'] | 'model_unavailable';
    message: string;
}

/** A connection's model, ready for a chat run: the sign-in has been resolved. */
export interface RunModel {
    models: MutableModels;
    model: Model<Api>;
}

export interface ConnectionTestResult {
    provider: ConnectionProvider;
    modelId: string;
    outcome: 'ok' | 'failed';
    latencyMs: number;
    reply: string | null;
    error: TestFailure | null;
}

/** An expected failure the HTTP layer turns into a contract error response. */
export class ConnectionError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export interface ConnectionManagerOptions {
    dataDirectory: string;
    key: Buffer;
    /** Provider factories; tests substitute fakes for the real providers. */
    providers: Record<CredentialProvider, () => Provider>;
    /** The administrator-configured local model server, if any. */
    local?: LocalModelServer | null;
    loginTimeoutMs: number;
    testTimeoutMs: number;
    now: () => number;
    log: (message: string) => void;
}

interface Connection {
    vault: CredentialVault;
    models: MutableModels;
}

const rejectionKey = (connectionId: string, provider: ConnectionProvider): string => `${connectionId}:${provider}`;

const shorten = (message: string): string =>
    message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message;

const describe = (error: unknown): string => shorten(error instanceof Error ? error.message : String(error));

/**
 * Provider sign-ins for Laravel's provider connections. Each connection gets its own encrypted
 * credential vault and Pi `Models`, so different users never share a login. Only one sign-in runs
 * at a time because the provider's browser callback uses a single fixed port.
 */
export class ConnectionManager {
    // One vault per connection for the life of the process: all of a connection's writes, including
    // Pi's token refresh, must go through the same serialized store. Bounded by Laravel's records.
    private readonly connections = new Map<string, Connection>();
    // Sign-ins whose renewal the provider refused. The credential stays stored until it is replaced,
    // so without this record its status would still read as connected.
    private readonly rejections: RenewalRejections;
    private login: LoginSession | null = null;
    private installation: Promise<string> | null = null;

    constructor(private readonly options: ConnectionManagerOptions) {
        this.rejections = new RenewalRejections(options.dataDirectory, options.log);
    }

    async startLogin(connectionId: string, provider: ConnectionProvider, agentName: string): Promise<LoginView> {
        requireAuthMethod(provider, 'oauth');
        const deviceId = await this.installationId();

        // No await between this check and claiming the slot, so concurrent starts cannot both pass.
        const active = this.login;
        if (active !== null && !active.finished) {
            if (active.connectionId === connectionId && active.provider === provider) {
                return active.view();
            }
            throw new ConnectionError(409, 'login_in_progress', 'Another sign-in is in progress. Finish or cancel it first.');
        }

        const { models } = this.connection(connectionId);
        const session = new LoginSession(connectionId, provider, this.options.now() + this.options.loginTimeoutMs);
        this.login = session;

        session.start(
            (interaction) => models.login(provider, 'oauth', interaction, { getDeviceId: () => deviceId, agentName }),
            this.options.loginTimeoutMs,
            (outcome) => {
                if (outcome === 'completed') {
                    // The new sign-in replaced the refused one.
                    this.rejections.delete(rejectionKey(connectionId, provider)).catch((error: unknown) => {
                        this.options.log(`Connection ${connectionId}: could not clear a refused renewal: ${describe(error)}`);
                    });
                }
                this.options.log(`Connection ${connectionId}: ${provider} sign-in ${outcome}`);
            },
        );
        await session.ready(STEP_WAIT_MS);

        return session.view();
    }

    loginView(connectionId: string): LoginView {
        return this.session(connectionId).view();
    }

    /** Hands the browser's final redirect address to the waiting sign-in. */
    async completeLogin(connectionId: string, redirectUrl: string): Promise<LoginView> {
        const session = this.session(connectionId);
        session.submit(redirectUrl);
        await session.settled(STEP_WAIT_MS);

        return session.view();
    }

    async cancelLogin(connectionId: string): Promise<LoginView> {
        const session = this.session(connectionId);
        await session.cancel('The sign-in was cancelled.');

        return session.view();
    }

    async status(connectionId: string, provider: ConnectionProvider): Promise<ConnectionStatus> {
        if (provider === 'local') {
            return this.localStatus(connectionId);
        }

        const { vault, models } = this.connection(connectionId);
        const catalog = models.getModels(provider).map((model) => model.id);

        try {
            const credential = await vault.read(provider);
            if (credential === undefined) {
                return { provider, status: 'not_connected', expiresAt: null, models: catalog, rejection: null };
            }

            const rejection = await this.rejections.get(rejectionKey(connectionId, provider));

            return {
                provider,
                status: rejection === null ? 'connected' : 'reauth_required',
                expiresAt: credential.type === 'oauth' ? credential.expires : null,
                models: catalog,
                rejection,
            };
        } catch (error) {
            if (error instanceof UnreadableCredentialsError) {
                return { provider, status: 'unreadable', expiresAt: null, models: catalog, rejection: null };
            }
            throw error;
        }
    }

    /** Removes the stored sign-in from this engine. Revoking access at the provider is the user's choice. */
    async disconnect(connectionId: string, provider: ConnectionProvider): Promise<ConnectionStatus> {
        if (provider === 'local') {
            // Nothing of the user's is stored for the shared local server.
            return { provider, status: 'not_connected', expiresAt: null, models: [], rejection: null };
        }
        if (this.login?.connectionId === connectionId) {
            // A sign-in that already stored its credential still finishes; the logout then removes it.
            await this.login.cancel('The connection was removed.');
        }
        await this.connection(connectionId).models.logout(provider);
        await this.rejections.delete(rejectionKey(connectionId, provider));

        return this.status(connectionId, provider);
    }

    /** Stores a key the user entered for an API-key provider, replacing any earlier one. */
    async saveKey(connectionId: string, provider: ConnectionProvider, apiKey: string): Promise<ConnectionStatus> {
        requireAuthMethod(provider, 'api_key');
        await this.connection(connectionId).vault.modify(provider, async () => ({ type: 'api_key', key: apiKey }));
        await this.rejections.delete(rejectionKey(connectionId, provider));

        return this.status(connectionId, provider);
    }

    /** Sends one short message with the stored sign-in. Uses the provider allowance; only on request. */
    async test(connectionId: string, provider: ConnectionProvider, modelId: string): Promise<ConnectionTestResult> {
        const { models } = this.connection(connectionId);
        if (provider === 'local') {
            await this.prepareLocal(models);
        }
        const model = models.getModel(provider, modelId);
        if (model === undefined) {
            throw new ConnectionError(422, 'unknown_model', `The ${provider} catalog has no model ${modelId}.`);
        }

        const started = this.options.now();
        const signal = AbortSignal.timeout(this.options.testTimeoutMs);
        const timeout: TestFailure = {
            code: 'timeout',
            message: `The provider did not answer within ${Math.round(this.options.testTimeoutMs / 1000)} seconds.`,
        };
        const result = (reply: string | null, error: TestFailure | null = null): ConnectionTestResult => ({
            provider,
            modelId,
            outcome: error === null ? 'ok' : 'failed',
            latencyMs: Math.max(0, this.options.now() - started),
            reply,
            error,
        });

        const unauthorized = await this.checkAuth(connectionId, provider, models, signal);
        if (unauthorized !== null) {
            return result(null, signal.aborted ? timeout : unauthorized);
        }

        try {
            const message = await models.completeSimple(
                model,
                { messages: [{ role: 'user', content: TEST_PROMPT, timestamp: Date.now() }] },
                // OpenCode routes requests by session; each test is its own session.
                { signal, maxTokens: TEST_MAX_TOKENS, sessionId: `connection-test-${randomUUID()}` },
            );
            if (message.stopReason === 'aborted') {
                return result(null, timeout);
            }
            if (message.stopReason === 'error') {
                return result(null, { code: 'provider_error', message: shorten(message.errorMessage ?? 'The provider returned an error.') });
            }

            const reply = message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('')
                .trim();

            return result(reply === '' ? null : shorten(reply));
        } catch (error) {
            return result(null, signal.aborted ? timeout : classifyAuthError(error, provider).failure);
        }
    }

    /**
     * The connection's model for a chat run. The sign-in is resolved (and refreshed if needed)
     * first, because request paths report auth problems only as stream errors.
     */
    async runModel(
        connectionId: string,
        provider: ConnectionProvider,
        modelId: string,
        signal: AbortSignal,
    ): Promise<RunModel | RunModelFailure> {
        const { models } = this.connection(connectionId);
        if (provider === 'local') {
            const local = this.options.local ?? null;
            if (local === null) {
                return { code: 'not_connected', message: 'No local model server is set up.' };
            }
            await this.prepareLocal(models);
            const view = local.view();
            if (!view.reachable) {
                return { code: 'provider_error', message: view.error ?? `${view.name ?? 'The local model server'} could not be reached.` };
            }
        }

        const model = models.getModel(provider, modelId);
        if (model === undefined) {
            return { code: 'model_unavailable', message: `The ${provider} catalog has no model ${modelId}.` };
        }

        return (await this.checkAuth(connectionId, provider, models, signal)) ?? { models, model };
    }

    /**
     * Resolves the stored sign-in, refreshing it if needed, and remembers whether the provider
     * still accepts it. Request paths report auth problems only as stream errors, so this runs first.
     * Every renewal and every failed one is logged with the provider's reason, never with a token.
     */
    private async checkAuth(
        connectionId: string,
        provider: ConnectionProvider,
        models: MutableModels,
        signal: AbortSignal,
    ): Promise<TestFailure | null> {
        const key = rejectionKey(connectionId, provider);
        const { vault } = this.connection(connectionId);
        const expiredBefore = await accessExpiry(vault, provider);

        try {
            if ((await models.getAuth(provider, { signal })) === undefined) {
                return { code: 'not_connected', message: 'This account is not connected.' };
            }
        } catch (error) {
            const { failure, reason } = classifyAuthError(error, provider);
            if (error instanceof ModelsError) {
                this.options.log(`Connection ${connectionId}: ${provider} sign-in could not be renewed (${reason}): ${failure.message}`);
            }
            if (failure.code === 'reauth_required') {
                await this.rejections.set(key, { reason, message: failure.message, at: this.options.now() });
            }

            return failure;
        }

        const expires = await accessExpiry(vault, provider);
        if (expires !== null && expires !== expiredBefore) {
            this.options.log(`Connection ${connectionId}: ${provider} sign-in renewed; access valid until ${new Date(expires).toISOString()}`);
        }
        // Only a working renewal or a new sign-in gets past a refused one.
        await this.rejections.delete(key);

        return null;
    }

    /** The shared local server's state; it needs no credential, so every user sees the same status. */
    private async localStatus(connectionId: string): Promise<ConnectionStatus> {
        const local = this.options.local ?? null;
        if (local === null) {
            return { provider: 'local', status: 'not_connected', expiresAt: null, models: [], rejection: null };
        }

        await this.prepareLocal(this.connection(connectionId).models);
        const view = local.view();

        return {
            provider: 'local',
            status: view.reachable ? 'connected' : 'unreachable',
            expiresAt: null,
            models: view.models,
            rejection: null,
        };
    }

    /** Refreshes the local model list and gives the connection's Pi models the current provider. */
    private async prepareLocal(models: MutableModels): Promise<void> {
        const local = this.options.local ?? null;
        if (local === null) {
            return;
        }

        await local.refresh();
        models.setProvider(local.provider());
    }

    private session(connectionId: string): LoginSession {
        if (this.login === null || this.login.connectionId !== connectionId) {
            throw new ConnectionError(404, 'no_login', 'No sign-in is in progress for this connection.');
        }

        return this.login;
    }

    private installationId(): Promise<string> {
        // One shared lookup; a failure is not cached, so the next sign-in tries again.
        this.installation ??= installationId(this.options.dataDirectory).catch((error: unknown) => {
            this.installation = null;
            throw error;
        });

        return this.installation;
    }

    private connection(connectionId: string): Connection {
        let connection = this.connections.get(connectionId);

        if (connection === undefined) {
            const vault = new CredentialVault(`${this.options.dataDirectory}/credentials`, connectionId, this.options.key);
            const models = createModels({ credentials: vault, authContext: NO_AMBIENT_AUTH });
            for (const provider of Object.keys(this.options.providers) as CredentialProvider[]) {
                models.setProvider(this.options.providers[provider]());
            }
            connection = { vault, models };
            this.connections.set(connectionId, connection);
        }

        return connection;
    }
}

function requireAuthMethod(provider: ConnectionProvider, method: 'oauth' | 'api_key'): void {
    if (CONNECTION_PROVIDERS[provider] !== method) {
        const how = { oauth: 'a browser sign-in', api_key: 'an API key', none: "the administrator's configuration" }[
            CONNECTION_PROVIDERS[provider]
        ];
        throw new ConnectionError(422, 'unsupported_auth_method', `${provider} connects with ${how}.`);
    }
}

/** How the connection's owner knows each provider, for messages about their sign-in. */
const PROVIDER_NAMES: Record<ConnectionProvider, string> = {
    openai: 'ChatGPT',
    opencode: 'OpenCode Zen',
    'opencode-go': 'OpenCode Go',
    local: 'The local model server',
};

interface AuthErrorOutcome {
    failure: TestFailure;
    /** A short code for the log and the refused-renewal record, such as `refresh_token_invalidated`. */
    reason: string;
}

function classifyAuthError(error: unknown, provider: ConnectionProvider): AuthErrorOutcome {
    if (error instanceof ModelsError && error.code === 'oauth') {
        // Pi reports every failed renewal this way, including ones that never reached the provider.
        // Only those end with a retryable error; the stored sign-in stays and the next request renews it.
        const interrupted = interruptedRenewal(error.cause);
        if (interrupted !== null) {
            return {
                reason: interrupted.reason,
                failure: {
                    code: 'provider_error',
                    message: shorten(
                        `The sign-in could not be renewed because ${interrupted.because}. The provider did not refuse it, so there is no need to sign in again; try again.`,
                    ),
                },
            };
        }

        // The provider refused the refresh token; the credential is kept until the user signs in again.
        const refusal = refusalOf(error.cause);

        return { reason: refusal.reason, failure: { code: 'reauth_required', message: shorten(refusalMessage(PROVIDER_NAMES[provider], refusal)) } };
    }
    if (error instanceof ModelsError && error.cause instanceof UnreadableCredentialsError) {
        return {
            reason: 'credentials_unreadable',
            failure: { code: 'credentials_unreadable', message: 'The stored sign-in cannot be read by this engine. Sign in again.' },
        };
    }

    return { reason: 'error', failure: { code: 'provider_error', message: describe(error) } };
}

/** When the stored access token expires; null without an OAuth sign-in or when it cannot be read. */
async function accessExpiry(vault: CredentialVault, provider: ConnectionProvider): Promise<number | null> {
    const credential = await vault.read(provider).catch(() => undefined);

    return credential?.type === 'oauth' ? credential.expires : null;
}

/** Pi's message for a token response other than 2xx: the status, then the provider's response body. */
const TOKEN_RESPONSE = /token request failed \((\d{3})\): ([\s\S]*)$/;
/** Provider reason codes are short snake_case words, such as `invalid_grant`. */
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** Long runs of token-like characters; never part of a message about a refused sign-in. */
const TOKEN_LIKE = /[A-Za-z0-9_\-.]{40,}/g;

interface Refusal {
    /** The provider's `error_reason` or `error`, `http_<status>` without either, or `renewal_failed`. */
    reason: string;
    detail: string | null;
}

/** What the provider said when it refused a renewal; OpenAI sends `error`, `error_reason` and a description. */
function refusalOf(cause: unknown): Refusal {
    const chain = causeChain(cause);
    for (const error of chain) {
        const response = TOKEN_RESPONSE.exec(error.message);
        if (response === null) {
            continue;
        }

        let body: Record<string, unknown> = {};
        try {
            const parsed: unknown = JSON.parse(response[2]!);
            body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
        } catch {
            // Not JSON; the status alone still says what happened.
        }
        const reason = [body.error_reason, body.error].find((value): value is string => typeof value === 'string' && REASON_CODE.test(value));

        return { reason: reason ?? `http_${response[1]}`, detail: typeof body.error_description === 'string' ? body.error_description : null };
    }

    // A renewal that failed in another way, for example an incomplete token response. The innermost
    // cause is the most specific.
    return { reason: 'renewal_failed', detail: chain.at(-1)?.message.replace(TOKEN_LIKE, '[redacted]') ?? null };
}

function refusalMessage(name: string, refusal: Refusal): string {
    switch (refusal.reason) {
        case 'refresh_token_invalidated':
            return `${name} invalidated this sign-in (refresh_token_invalidated), which happens for example after a password change or signing out of all devices. Sign in again.`;
        case 'refresh_token_expired':
            return `This sign-in expired at ${name} (refresh_token_expired). Sign in again.`;
        case 'refresh_token_reused':
            return `${name} ended this sign-in because its renewal token was used twice (refresh_token_reused). Sign in again.`;
        case 'renewal_failed':
            return `The sign-in could not be renewed${refusal.detail === null ? '' : ` (${refusal.detail})`}. Sign in again.`;
        default:
            return `${name} refused to renew this sign-in (${refusal.reason}). Sign in again.`;
    }
}

function causeChain(cause: unknown): Error[] {
    const chain: Error[] = [];
    for (let link = cause; link instanceof Error && chain.length < MAX_CAUSE_DEPTH; link = link.cause) {
        chain.push(link);
    }

    return chain;
}

/** How deep a renewal failure's `cause` chain is searched; undici nests its code two levels down. */
const MAX_CAUSE_DEPTH = 6;
/** A token response the provider sends when it refuses the refresh token itself. */
const REFUSED = /token request failed \((400|401|403)\)|invalid_grant|unauthorized_client|revoked/i;
/** A token response that says nothing about the refresh token: the provider was busy or failing. */
const PROVIDER_SIDE = /token request failed \((408|429|5\d\d)\)/;
/** Node's certificate verification codes. On a desktop, security software that scans HTTPS usually causes them. */
const CERTIFICATE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;
/** System and undici connection codes such as ECONNRESET, ENOTFOUND or UND_ERR_CONNECT_TIMEOUT. */
const NETWORK = /^(E[A-Z]+|UND_ERR_[A-Z_]+)$/;

/**
 * Why a renewal ended without the provider refusing the sign-in: the request did not get through,
 * timed out, or met a provider-side error. Null when the provider refused it, or when the cause is
 * not recognized, so asking the user to sign in again stays the default.
 */
function interruptedRenewal(cause: unknown): { reason: string; because: string } | null {
    const chain = causeChain(cause);
    if (chain.some((error) => REFUSED.test(error.message))) {
        return null;
    }

    const code = chain.map((error) => (error as { code?: unknown }).code).find((value) => typeof value === 'string') as string | undefined;
    if (code !== undefined && CERTIFICATE.test(code)) {
        return {
            reason: code.toLowerCase(),
            because:
                `the connection to the provider was intercepted with a certificate this server does not trust (${code}). ` +
                "Security software that scans HTTPS connections usually causes this; exclude the provider's sites from that scanning",
        };
    }
    if (chain.some((error) => error.name === 'TimeoutError')) {
        return { reason: 'timeout', because: 'the provider did not answer in time' };
    }
    const network = code !== undefined && NETWORK.test(code);
    if (network || chain.some((error) => error instanceof TypeError && error.message === 'fetch failed')) {
        return { reason: network ? code.toLowerCase() : 'unreachable', because: `the provider could not be reached${network ? ` (${code})` : ''}` };
    }
    const status = chain.map((error) => PROVIDER_SIDE.exec(error.message)?.[1]).find((value) => value !== undefined);

    return status === undefined ? null : { reason: `http_${status}`, because: `the provider had a temporary problem (${status})` };
}

/**
 * Catches pasting mistakes before the provider flow sees them. The flow treats any bad address as
 * a failed sign-in, while a paste refused here leaves the sign-in waiting for another try. An
 * address that reports a provider error is passed on, because that sign-in really failed.
 */
function redirectProblem(authUrl: string, input: string): string | null {
    const authorization = new URL(authUrl);
    const expected = new URL(authorization.searchParams.get('redirect_uri') ?? '');

    let redirect: URL;
    try {
        redirect = new URL(input.trim());
    } catch {
        return "Paste the complete address from the browser's address bar.";
    }

    if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname) {
        return `The address must start with ${expected.origin}${expected.pathname}.`;
    }
    if (redirect.searchParams.has('error')) {
        return null;
    }
    if (redirect.searchParams.get('state') !== authorization.searchParams.get('state')) {
        return 'This address belongs to a different sign-in. Use the address from the latest sign-in tab.';
    }
    if (!redirect.searchParams.get('code')) {
        return 'The address is incomplete. Copy the whole address from the browser.';
    }

    return null;
}

/** One provider sign-in, driven by Pi and observed by Laravel through polling. */
class LoginSession {
    state: LoginState = 'starting';
    finished = false;
    private authUrl: string | null = null;
    private error: string | null = null;
    private readonly controller = new AbortController();
    private cancelReason = 'The sign-in was cancelled.';
    private pending: ((redirectUrl: string) => void) | null = null;
    /** Each waiter returns true once it has resolved and can be dropped. */
    private waiters: (() => boolean)[] = [];
    private timer: NodeJS.Timeout | null = null;

    constructor(
        readonly connectionId: string,
        readonly provider: ConnectionProvider,
        private readonly expiresAt: number,
    ) {}

    start(run: (interaction: AuthInteraction) => Promise<unknown>, timeoutMs: number, report: (outcome: string) => void): void {
        this.timer = setTimeout(() => void this.cancel('The sign-in took too long. Start again.'), timeoutMs);
        this.timer.unref();

        run(this.interaction()).then(
            () => {
                this.finish('connected', null);
                report('completed');
            },
            (error: unknown) => {
                const cancelled = this.controller.signal.aborted;
                const message = cancelled ? this.cancelReason : describe(error);
                this.finish(cancelled ? 'cancelled' : 'failed', message);
                report(cancelled ? 'cancelled' : `failed: ${message}`);
            },
        );
    }

    view(): LoginView {
        return {
            provider: this.provider,
            state: this.state,
            authUrl: this.state === 'waiting_for_user' ? this.authUrl : null,
            error: this.error,
            expiresAt: this.expiresAt,
        };
    }

    submit(redirectUrl: string): void {
        if (this.state !== 'waiting_for_user' || this.pending === null || this.authUrl === null) {
            throw new ConnectionError(409, 'login_not_waiting', 'This sign-in is not waiting for a redirect address.');
        }

        const problem = redirectProblem(this.authUrl, redirectUrl);
        if (problem !== null) {
            throw new ConnectionError(422, 'invalid_redirect', problem);
        }

        const resolve = this.pending;
        this.pending = null;
        this.state = 'exchanging';
        resolve(redirectUrl.trim());
    }

    /** Aborts the flow; Pi settles it asynchronously, so this waits (bounded) for the outcome. */
    async cancel(reason: string): Promise<void> {
        if (!this.finished) {
            this.cancelReason = reason;
            this.controller.abort();
        }
        await this.settled(STEP_WAIT_MS);
    }

    /** Resolves once the sign-in address is known or the sign-in has ended, or after `timeoutMs`. */
    ready(timeoutMs: number): Promise<void> {
        return this.waitFor(() => this.authUrl !== null || this.finished, timeoutMs);
    }

    /** Resolves once a submitted address has been accepted or rejected, or after `timeoutMs`. */
    settled(timeoutMs: number): Promise<void> {
        return this.waitFor(() => this.finished, timeoutMs);
    }

    private interaction(): AuthInteraction {
        return {
            signal: this.controller.signal,
            notify: (event) => {
                if (event.type === 'auth_url') {
                    this.authUrl = event.url;
                    this.state = 'waiting_for_user';
                } else if (event.type === 'progress' && this.state === 'waiting_for_user') {
                    // The browser callback reached the engine directly; the code is being exchanged.
                    this.state = 'exchanging';
                }
                this.wake();
            },
            prompt: (prompt) => {
                if (prompt.type !== 'manual_code') {
                    return Promise.reject(new Error('This sign-in asked for input the app does not support.'));
                }

                return new Promise<string>((resolve, reject) => {
                    this.pending = resolve;
                    // Pi aborts the prompt once its own callback server has received the redirect.
                    prompt.signal?.addEventListener(
                        'abort',
                        () => {
                            this.pending = null;
                            reject(new Error('The browser completed the sign-in.'));
                        },
                        { once: true },
                    );
                });
            },
        };
    }

    private finish(state: LoginState, error: string | null): void {
        if (this.finished) {
            return;
        }

        this.finished = true;
        this.state = state;
        this.error = error;
        this.pending = null;
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.wake();
    }

    private waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
        if (condition()) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const waiter = (): boolean => {
                if (!condition()) {
                    return false;
                }
                clearTimeout(timer);
                resolve();

                return true;
            };
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter((other) => other !== waiter);
                resolve();
            }, timeoutMs);
            this.waiters.push(waiter);
        });
    }

    private wake(): void {
        this.waiters = this.waiters.filter((waiter) => !waiter());
    }
}
