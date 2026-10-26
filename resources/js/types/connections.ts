/** Shapes of the Connections page props (ConnectionsController). */

export type ConnectionProviderId =
    | 'openai'
    | 'opencode-go'
    | 'opencode'
    | 'local';

/** A ChatGPT browser sign-in, while it runs or until its sign-in window ends. */
export type ChatGptSignIn = {
    state:
        | 'starting'
        | 'waiting_for_user'
        | 'exchanging'
        | 'connected'
        | 'failed'
        | 'cancelled';
    /** The provider's sign-in page; present only while waiting for the user. */
    auth_url: string | null;
    error: string | null;
    expires_at: string | null;
};

export type ProviderConnectionCard = {
    provider: ConnectionProviderId;
    name: string;
    /**
     * `oauth`: the provider's browser sign-in; `api_key`: a key the user pastes; `none`: the
     * administrator's local model server, shared by every user.
     */
    auth: 'oauth' | 'api_key' | 'none';
    /**
     * Null when the engine could not be asked; `unreachable` only for the local server;
     * `reauth_required` after the provider rejected the stored sign-in or key.
     */
    status:
        | 'connected'
        | 'not_connected'
        | 'unreadable'
        | 'unreachable'
        | 'reauth_required'
        | null;
    expires_at: string | null;
    /** Why and when the provider refused to renew the sign-in; set with `reauth_required`. */
    rejection: {
        /** The provider's reason code, such as `refresh_token_invalidated`. */
        reason: string;
        message: string;
        at: string | null;
    } | null;
    /** The provider's model catalog; empty until connected. */
    models: string[];
    /** Empty when the local server lists no models. */
    test_model: string;
    login: ChatGptSignIn | null;
    /** The local server's setup, only on the local card. */
    local: LocalServer | null;
};

export type LocalServer = {
    /** False until the administrator sets LOCAL_LLM_URL. */
    configured: boolean;
    base_url: string | null;
    /** Why the server could not be read. */
    error: string | null;
};

/** The connection and model chosen for chat replies. */
export type ChatChoice = {
    provider: ConnectionProviderId;
    name: string;
    model: string;
    connected: boolean;
};

export type ConnectionsOverview = {
    engine: 'available' | 'not_configured' | 'unavailable';
    providers: ProviderConnectionCard[];
    chat: ChatChoice | null;
};

/** Flash data after "Send test message". */
export type ConnectionTest = {
    provider: ConnectionProviderId;
    model_id: string;
    ok: boolean;
    latency_ms: number;
    reply: string | null;
    error_code: string | null;
    error: string | null;
};
