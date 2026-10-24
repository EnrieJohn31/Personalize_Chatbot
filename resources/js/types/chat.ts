// Shapes returned by the /api/chat resources (see docs/chat-history.md).

export type ChatRole = 'user' | 'assistant';

export type Conversation = {
    id: string;
    title: string;
    provider_connection_id: string | null;
    /** The provider and model this conversation was started with; null uses the built-in assistant. */
    model_provider: string | null;
    model: string | null;
    created_at: string;
    updated_at: string;
};

export type ChatMessage = {
    id: string;
    conversation_id: string;
    sequence: number;
    role: ChatRole;
    content: string;
    /** The model that wrote an assistant reply; null for user messages and built-in replies. */
    model: string | null;
    created_at: string;
};

/** Who answers a conversation (ChatPageController). */
export type ChatAssistant = {
    /** Null for the built-in assistant. */
    provider: string | null;
    name: string;
    model: string | null;
    /** False when the chosen account is not connected right now. */
    ready: boolean;
    /** False while replies still come from the built-in simulation (before task 3.2). */
    live: boolean;
};

export type ConversationList = {
    data: Conversation[];
    next_page_url: string | null;
};

export type MessageHistory = {
    data: ChatMessage[];
    next_before_sequence: number | null;
    per_page: number;
};

/** A run being streamed (Stage A relay, docs/chat-ui.md). */
export type ChatRun = {
    id: string;
    conversation_id: string;
    events_url: string;
};

/** Engine events relayed with an SSE id, plus the relay's own `stream.error`. */
export type RunEventType =
    | 'run.started'
    | 'run.progress'
    | 'assistant.delta'
    | 'assistant.final'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled'
    | 'stream.error';

export type ProgressStage = 'preparing' | 'retrieving' | 'answering';

export type ChatPageProps = {
    conversations: ConversationList;
    conversation: Conversation | null;
    messages: MessageHistory | null;
    /** The user's unfinished reply, if any, so the page can resume its stream. */
    active_run: ChatRun | null;
    assistant: ChatAssistant;
};
