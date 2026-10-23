// Shapes returned by the /api/chat resources (see docs/chat-history.md).

export type ChatRole = 'user' | 'assistant';

export type Conversation = {
    id: string;
    title: string;
    provider_connection_id: string | null;
    created_at: string;
    updated_at: string;
};

export type ChatMessage = {
    id: string;
    conversation_id: string;
    sequence: number;
    role: ChatRole;
    content: string;
    created_at: string;
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

export type ChatPageProps = {
    conversations: ConversationList;
    conversation: Conversation | null;
    messages: MessageHistory | null;
};
