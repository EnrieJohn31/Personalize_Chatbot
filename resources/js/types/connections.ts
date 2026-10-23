/** Shapes of the Connections page props (ConnectionsController). */

export type ConnectionProviderId = 'openai' | 'opencode-go' | 'opencode';

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
    /** `oauth`: the provider's browser sign-in; `api_key`: a key the user pastes. */
    auth: 'oauth' | 'api_key';
    /** Null when the engine could not be asked. */
    status: 'connected' | 'not_connected' | 'unreadable' | null;
    expires_at: string | null;
    /** The provider's model catalog; empty until connected. */
    models: string[];
    test_model: string;
    login: ChatGptSignIn | null;
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
