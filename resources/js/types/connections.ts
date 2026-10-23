/** One ChatGPT sign-in as Settings > Connections receives it (ConnectionsController). */
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

export type ChatGptConnection = {
    engine: 'available' | 'not_configured' | 'unavailable';
    /** Null when the engine could not be asked. */
    status: 'connected' | 'not_connected' | 'unreadable' | null;
    expires_at: string | null;
    models: string[];
    /** The latest sign-in while it runs, or its outcome until its sign-in window ends. */
    login: ChatGptSignIn | null;
};

/** Flash data after "Send test message". */
export type ConnectionTest = {
    model_id: string;
    ok: boolean;
    latency_ms: number;
    reply: string | null;
    error_code: string | null;
    error: string | null;
};
