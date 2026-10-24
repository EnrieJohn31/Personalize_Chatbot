import { describe, expect, test } from 'vite-plus/test';
import { showStartedConversation } from '@/lib/conversation-address';
import type { ChatMessage, ChatPageProps, Conversation } from '@/types';

type Push = {
    url: string;
    preserveState: boolean;
    preserveScroll: boolean;
    props: (props: ChatPageProps) => ChatPageProps;
};

const conversation: Conversation = {
    id: '01a16d3f-047d-7037-ad86-107c870597ca',
    title: 'Hello there',
    provider_connection_id: null,
    model_provider: null,
    model: null,
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T10:00:00Z',
};

const firstMessage: ChatMessage = {
    id: '01a16d3f-0a1b-7c2d-8e3f-405162738495',
    conversation_id: conversation.id,
    sequence: 1,
    role: 'user',
    content: 'Hello there',
    model: null,
    created_at: '2026-10-24T10:00:01Z',
};

/** The new-chat page's props, with a reply of another conversation still running. */
const newChatProps: ChatPageProps = {
    conversations: { data: [], next_page_url: null },
    conversation: null,
    messages: null,
    active_run: {
        id: '01a16d3f-1111-7222-8333-444455556666',
        conversation_id: '01a16d3f-9999-7999-8999-999999999999',
        events_url:
            '/api/chat/runs/01a16d3f-1111-7222-8333-444455556666/events',
    },
    assistant: {
        provider: null,
        name: 'Assistant',
        model: null,
        ready: true,
        live: false,
    },
};

function pushed(): Push {
    const pushes: Push[] = [];
    showStartedConversation(
        { push: (params: unknown) => pushes.push(params as Push) } as never,
        conversation,
        firstMessage,
    );
    expect(pushes).toHaveLength(1);

    return pushes[0];
}

describe('showStartedConversation', () => {
    test('moves to the conversation address on the client, keeping the page state', () => {
        const push = pushed();

        expect(push.url).toBe(`/chat/${conversation.id}`);
        expect(push.preserveState).toBe(true);
        expect(push.preserveScroll).toBe(true);
    });

    test('stores props that describe the conversation and resume no second stream', () => {
        const props = pushed().props(newChatProps);

        expect(props.conversation).toEqual(conversation);
        expect(props.messages?.data).toEqual([firstMessage]);
        expect(props.messages?.next_before_sequence).toBeNull();
        expect(props.active_run).toBeNull();
        expect(props.conversations).toBe(newChatProps.conversations);
        expect(props.assistant).toBe(newChatProps.assistant);
    });
});
