import { router } from '@inertiajs/react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';

type InertiaRouter = Pick<typeof router, 'on' | 'flushAll' | 'visit'>;

/**
 * Inertia reuses page data it already holds: a prefetched page for 30 seconds, and the copy kept in
 * browser history for Back and Forward. A change made in between, such as a deleted chat, would
 * then seem undone until a reload. Call once at startup, before the first page is shown.
 */
export function keepPagesFresh(
    inertia: InertiaRouter,
    onConversationGone: () => void,
): void {
    // An Inertia write only clears the prefetched copy of the page it lands on.
    inertia.on('finish', (event) => {
        const { visit } = event.detail;

        if (visit.method !== 'get' && visit.completed) {
            inertia.flushAll();
        }
    });

    // The chat page builds its state from its props once, so a copy restored from history is
    // replaced with fresh props. A conversation deleted meanwhile leads back to a new chat.
    inertia.on('navigate', (event) => {
        const { page, type } = event.detail;

        if (type !== 'history' || page.component !== 'chat/index') {
            return;
        }

        inertia.visit(page.url, {
            replace: true,
            preserveScroll: true,
            onHttpException: (response) => {
                if (response.status !== 404) {
                    return;
                }

                onConversationGone();
                inertia.visit(ChatPageController.index.url(), {
                    replace: true,
                });

                return false;
            },
        });
    });
}
