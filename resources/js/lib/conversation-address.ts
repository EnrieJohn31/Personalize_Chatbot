import type { router } from '@inertiajs/react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import type { ChatMessage, ChatPageProps, Conversation } from '@/types';

type InertiaRouter = Pick<typeof router, 'push'>;

/** Matches the first history page ChatPageController sends (ConversationRepository::historyPage). */
const HISTORY_PAGE_SIZE = 50;

/**
 * Gives a chat started on the new-chat page its own address without asking the server for the
 * page again. A server visit would remount the page and restart the reply's stream; this keeps the
 * page and its state, so the reply streams on in place. The props stored with the new history
 * entry describe the conversation; Back and Forward fetch the page again anyway (fresh-pages.ts).
 */
export function showStartedConversation(
    inertia: InertiaRouter,
    conversation: Conversation,
    firstMessage: ChatMessage,
): void {
    inertia.push<ChatPageProps>({
        url: ChatPageController.show.url(conversation.id),
        preserveState: true,
        preserveScroll: true,
        props: (props) => ({
            ...props,
            conversation,
            messages: {
                data: [firstMessage],
                next_before_sequence: null,
                per_page: HISTORY_PAGE_SIZE,
            },
            // The page already follows the reply it starts; a run here would open a second stream.
            active_run: null,
        }),
    });
}
