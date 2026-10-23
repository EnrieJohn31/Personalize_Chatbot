import { useState } from 'react';
import {
    ChatApiError,
    fetchConversations,
    renameConversation,
} from '@/lib/chat-api';
import type { Conversation, ConversationList } from '@/types';

export type UseConversationsReturn = {
    items: Conversation[];
    hasMore: boolean;
    loadingMore: boolean;
    error: string | null;
    loadMore: () => Promise<void>;
    rename: (id: string, title: string) => Promise<Conversation>;
    moveToTop: (conversation: Conversation) => void;
};

/** The owner's conversation list: the first page arrives as page props, later pages via the API. */
export function useConversations(
    initial: ConversationList,
): UseConversationsReturn {
    const [items, setItems] = useState(initial.data);
    const [nextUrl, setNextUrl] = useState(initial.next_page_url);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadMore = async (): Promise<void> => {
        if (nextUrl === null || loadingMore) {
            return;
        }

        setLoadingMore(true);
        setError(null);

        try {
            const page = await fetchConversations(nextUrl);
            // Activity can reorder the list between pages, so skip entries already shown.
            setItems((current) => [
                ...current,
                ...page.data.filter(
                    (candidate) =>
                        !current.some((item) => item.id === candidate.id),
                ),
            ]);
            setNextUrl(page.nextUrl);
        } catch (caught) {
            setError(
                caught instanceof ChatApiError
                    ? caught.message
                    : 'Conversations could not be loaded.',
            );
        } finally {
            setLoadingMore(false);
        }
    };

    const rename = async (id: string, title: string): Promise<Conversation> => {
        const updated = await renameConversation(id, title);
        setItems((current) =>
            current.map((item) => (item.id === id ? updated : item)),
        );

        return updated;
    };

    const moveToTop = (conversation: Conversation): void => {
        setItems((current) => [
            conversation,
            ...current.filter((item) => item.id !== conversation.id),
        ]);
    };

    return {
        items,
        hasMore: nextUrl !== null,
        loadingMore,
        error,
        loadMore,
        rename,
        moveToTop,
    };
}
