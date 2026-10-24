import { randomUUID } from 'node:crypto';
import { createModels, ModelsError, type AuthInteraction, type MutableModels, type Provider } from '@earendil-works/pi-ai';
import { CredentialVault, UnreadableCredentialsError } from './credential-vault.js';
import { installationId } from './installation.js';
import type { LocalModelServer } from './local-model.js';

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
    /** `unreachable`: the local model server is configured but did not answer. */
    status: 'connected' | 'not_connected' | 'unreadable' | 'unreachable';
    expiresAt: number | null;
    models: string[];
}

export interface TestFailure {
    code: 'not_connected' | 'reauth_required' | 'credentials_unreadable' | 'provider_error' | 'timeout';
    message: string;
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
    private login: LoginSession | null = null;
    private installation: Promise<string> | null = null;

    constructor(private readonly options: ConnectionManagerOptions) {}

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
            (outcome) => this.options.log(`Connection ${connectionId}: ${provider} sign-in ${outcome}`),
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
                return { provider, status: 'not_connected', expiresAt: null, models: catalog };
            }

            return { provider, status: 'connected', expiresAt: credential.type === 'oauth' ? credential.expires : null, models: catalog };
        } catch (error) {
            if (error instanceof UnreadableCredentialsError) {
                return { provider, status: 'unreadable', expiresAt: null, models: catalog };
            }
            throw error;
        }
    }

    /** Removes the stored sign-in from this engine. Revoking access at the provider is the user's choice. */
    async disconnect(connectionId: string, provider: ConnectionProvider): Promise<ConnectionStatus> {
        if (provider === 'local') {
            // Nothing of the user's is stored for the shared local server.
            return { provider, status: 'not_connected', expiresAt: null, models: [] };
        }
        if (this.login?.connectionId === connectionId) {
            // A sign-in that already stored its credential still finishes; the logout then removes it.
            await this.login.cancel('The connection was removed.');
        }
        await this.connection(connectionId).models.logout(provider);

        return this.status(connectionId, provider);
    }

    /** Stores a key the user entered for an API-key provider, replacing any earlier one. */
    async saveKey(connectionId: string, provider: ConnectionProvider, apiKey: string): Promise<ConnectionStatus> {
        requireAuthMethod(provider, 'api_key');
        await this.connection(connectionId).vault.modify(provider, async () => ({ type: 'api_key', key: apiKey }));

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

        try {
            // Request paths report auth problems only as stream errors, so resolve the sign-in first.
            if ((await models.getAuth(provider, { signal })) === undefined) {
                return result(null, { code: 'not_connected', message: 'Connect the account before testing it.' });
            }

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
            return result(null, signal.aborted ? timeout : authFailure(error));
        }
    }

    /** The shared local server's state; it needs no credential, so every user sees the same status. */
    private async localStatus(connectionId: string): Promise<ConnectionStatus> {
        const local = this.options.local ?? null;
        if (local === null) {
            return { provider: 'local', status: 'not_connected', expiresAt: null, models: [] };
        }

        await this.prepareLocal(this.connection(connectionId).models);
        const view = local.view();

        return { provider: 'local', status: view.reachable ? 'connected' : 'unreachable', expiresAt: null, models: view.models };
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

function authFailure(error: unknown): TestFailure {
    if (error instanceof ModelsError && error.code === 'oauth') {
        // The refresh token was rejected; the stored credential is kept until the user signs in again.
        return { code: 'reauth_required', message: 'The sign-in has expired or was revoked. Sign in again.' };
    }
    if (error instanceof ModelsError && error.cause instanceof UnreadableCredentialsError) {
        return { code: 'credentials_unreadable', message: 'The stored sign-in cannot be read by this engine. Sign in again.' };
    }

    return { code: 'provider_error', message: describe(error) };
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
