import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import type { DisplayMessage } from '@/components/chat/chat-message';
import { ChatMessageItem } from '@/components/chat/chat-message';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Distance from the bottom, in pixels, that still counts as following the conversation. */
const FOLLOW_THRESHOLD = 80;

type Props = {
    messages: DisplayMessage[];
    hasOlder: boolean;
    loadingOlder: boolean;
    onLoadOlder: () => Promise<boolean>;
    empty: ReactNode;
};

export function ChatMessageList({
    messages,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    empty,
}: Props) {
    const scroller = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const distanceFromBottom = useRef<number | null>(null);
    const firstKey = messages[0]?.key;
    const lastKey = messages.at(-1)?.key;
    const lastIsPending = messages.at(-1)?.pending ?? false;

    // Keep the reader's place when older messages are inserted above.
    useLayoutEffect(() => {
        const element = scroller.current;

        if (element && distanceFromBottom.current !== null) {
            element.scrollTop =
                element.scrollHeight - distanceFromBottom.current;
            distanceFromBottom.current = null;
        }
    }, [firstKey]);

    // Follow new messages only while the reader is near the bottom, or after sending.
    useLayoutEffect(() => {
        const element = scroller.current;

        if (element && (following.current || lastIsPending)) {
            element.scrollTop = element.scrollHeight;
        }
    }, [lastKey, lastIsPending]);

    const loadOlder = async (): Promise<void> => {
        const element = scroller.current;

        if (element) {
            distanceFromBottom.current =
                element.scrollHeight - element.scrollTop;
        }

        if (!(await onLoadOlder())) {
            distanceFromBottom.current = null;
        }
    };

    return (
        <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onScroll={(event) => {
                const element = event.currentTarget;
                following.current =
                    element.scrollHeight -
                        element.scrollTop -
                        element.clientHeight <
                    FOLLOW_THRESHOLD;
            }}
        >
            <section
                aria-label="Messages"
                className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6"
            >
                {hasOlder && (
                    <div className="mb-4 flex justify-center">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingOlder}
                            onClick={() => void loadOlder()}
                        >
                            {loadingOlder && <Spinner />}
                            Load earlier messages
                        </Button>
                    </div>
                )}

                {messages.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                        {empty}
                    </div>
                ) : (
                    <ol className="flex flex-col gap-3">
                        {messages.map((message) => (
                            <ChatMessageItem
                                key={message.key}
                                message={message}
                            />
                        ))}
                    </ol>
                )}
            </section>
        </div>
    );
}
