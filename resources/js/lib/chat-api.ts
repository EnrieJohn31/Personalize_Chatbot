import { http } from '@inertiajs/react';
import ChatRunController from '@/actions/App/Http/Controllers/ChatRunController';
import ConversationController from '@/actions/App/Http/Controllers/ConversationController';
import MessageController from '@/actions/App/Http/Controllers/MessageController';
import type {
    ChatMessage,
    ChatRun,
    Conversation,
    MessageHistory,
} from '@/types';

// JSON calls to the session-authenticated /api/chat endpoints. Inertia's HTTP client
// sends the XSRF cookie as X-XSRF-TOKEN for same-origin URLs.

export class ChatApiError extends Error {
    constructor(
        message: string,
        readonly status: number | null,
        /** The server's error code, for example `connection_not_ready`, when it sent one. */
        readonly code: string | null = null,
    ) {
        super(message);
    }
}

type Page<T> = { data: T[]; links: { next: string | null } };

export async function fetchConversations(
    url: string,
): Promise<{ data: Conversation[]; nextUrl: string | null }> {
    const page = await request<Page<Conversation>>('get', url);

    return { data: page.data, nextUrl: page.links.next };
}

export async function createConversation(title: string): Promise<Conversation> {
    const response = await request<{ data: Conversation }>(
        'post',
        ConversationController.store.url(),
        { title },
    );

    return response.data;
}

export async function renameConversation(
    id: string,
    title: string,
): Promise<Conversation> {
    const response = await request<{ data: Conversation }>(
        'patch',
        ConversationController.update.url(id),
        { title },
    );

    return response.data;
}

export async function fetchMessagesBefore(
    conversationId: string,
    beforeSequence: number,
): Promise<MessageHistory> {
    const response = await request<{ messages: MessageHistory }>(
        'get',
        ConversationController.show.url(conversationId, {
            query: { before_sequence: beforeSequence },
        }),
    );

    return response.messages;
}

export async function appendMessage(
    conversationId: string,
    content: string,
): Promise<ChatMessage> {
    const response = await request<{ data: ChatMessage }>(
        'post',
        MessageController.store.url(conversationId),
        { content },
    );

    return response.data;
}

/** Asks for a reply to the conversation's latest user message. */
export async function startRun(conversationId: string): Promise<ChatRun> {
    const response = await request<{ data: ChatRun }>(
        'post',
        ChatRunController.store.url(conversationId),
    );

    return response.data;
}

export async function stopRun(runId: string): Promise<void> {
    await request('delete', ChatRunController.destroy.url(runId));
}

/**
 * Permanently deletes conversations and their messages. Resolves to the IDs the server deleted;
 * any others no longer exist for this user.
 */
export async function deleteConversations(ids: string[]): Promise<string[]> {
    const response =
        ids.length === 1
            ? await request<{ deleted: string[] }>(
                  'delete',
                  ConversationController.destroy.url(ids[0]),
              )
            : await request<{ deleted: string[] }>(
                  'delete',
                  ConversationController.destroyMany.url(),
                  { ids },
              );

    return response.deleted;
}

async function request<T>(
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    data?: Record<string, unknown>,
): Promise<T> {
    let body: string;

    try {
        const response = await http.getClient().request({
            method,
            url,
            data,
            headers: { Accept: 'application/json' },
        });
        body = response.data;
    } catch (error) {
        throw toChatApiError(error);
    }

    return JSON.parse(body) as T;
}

function toChatApiError(error: unknown): ChatApiError {
    const response =
        typeof error === 'object' && error !== null && 'response' in error
            ? (error as { response: { status: number; data: string } }).response
            : null;

    if (response === null) {
        return new ChatApiError(
            'The server could not be reached. Check your connection and try again.',
            null,
        );
    }

    return new ChatApiError(
        messageForStatus(response.status, response.data),
        response.status,
        serverCode(response.data),
    );
}

function serverCode(body: string): string | null {
    try {
        const parsed = JSON.parse(body) as { code?: unknown };

        return typeof parsed.code === 'string' ? parsed.code : null;
    } catch {
        return null;
    }
}

function messageForStatus(status: number, body: string): string {
    switch (status) {
        case 401:
            return 'You are signed out. Sign in again to continue.';
        case 403:
            return 'Verify your email address to use chat.';
        case 404:
            return 'This conversation is not available.';
        case 419:
            return 'Your session expired. Reload the page and try again.';
        case 422:
            return (
                firstValidationError(body) ?? 'Check your input and try again.'
            );
        case 429:
            return 'Too many requests. Wait a moment and try again.';
        default:
            // The run endpoints return a user-facing message with 409, 502 and 503.
            return (
                serverMessage(body) ??
                'Something went wrong on the server. Try again.'
            );
    }
}

function serverMessage(body: string): string | null {
    try {
        const parsed = JSON.parse(body) as { code?: string; message?: string };

        return typeof parsed.code === 'string' &&
            typeof parsed.message === 'string'
            ? parsed.message
            : null;
    } catch {
        return null;
    }
}

function firstValidationError(body: string): string | null {
    try {
        const parsed = JSON.parse(body) as {
            errors?: Record<string, string[]>;
            message?: string;
        };

        return (
            Object.values(parsed.errors ?? {})[0]?.[0] ?? parsed.message ?? null
        );
    } catch {
        return null;
    }
}
