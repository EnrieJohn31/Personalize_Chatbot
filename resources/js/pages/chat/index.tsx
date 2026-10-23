import { Head, router } from '@inertiajs/react';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import { AppShell } from '@/components/app-shell';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatHeader } from '@/components/chat/chat-header';
import type { DisplayMessage } from '@/components/chat/chat-message';
import { ChatMessageList } from '@/components/chat/chat-message-list';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { RenameConversationDialog } from '@/components/chat/rename-conversation-dialog';
import { SidebarInset } from '@/components/ui/sidebar';
import { useConversations } from '@/hooks/use-conversations';
import {
    ChatApiError,
    appendMessage,
    createConversation,
    fetchMessagesBefore,
} from '@/lib/chat-api';
import { titleFromMessage } from '@/lib/chat-composer';
import type { ChatMessage, ChatPageProps, Conversation } from '@/types';

const errorMessage = (caught: unknown): string =>
    caught instanceof ChatApiError
        ? caught.message
        : 'Something went wrong. Try again.';

export default function ChatPage({
    conversations,
    conversation,
    messages,
}: ChatPageProps) {
    const sidebar = useConversations(conversations);
    // A conversation created on this page stays here until its first message is saved.
    const [current, setCurrent] = useState(conversation);
    const [history, setHistory] = useState<ChatMessage[]>(messages?.data ?? []);
    const [olderCursor, setOlderCursor] = useState(
        messages?.next_before_sequence ?? null,
    );
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const [renaming, setRenaming] = useState<Conversation | null>(null);

    const fail = (caught: unknown): false => {
        const message = errorMessage(caught);
        setError(message);
        setAnnouncement(message);

        return false;
    };

    const send = async (content: string): Promise<boolean> => {
        setError(null);
        setPending(content);

        try {
            let target = current;

            if (target === null) {
                target = await createConversation(titleFromMessage(content));
                setCurrent(target);
                sidebar.moveToTop(target);
            }

            const saved = await appendMessage(target.id, content);

            if (conversation === null) {
                // Open the new conversation's own address so reloads and links work.
                router.visit(ChatPageController.show.url(target.id));

                return true;
            }

            setHistory((list) => [...list, saved]);
            sidebar.moveToTop({ ...target, updated_at: saved.created_at });
            setAnnouncement('Message sent.');

            return true;
        } catch (caught) {
            return fail(caught);
        } finally {
            setPending(null);
        }
    };

    const loadOlder = async (): Promise<boolean> => {
        if (current === null || olderCursor === null) {
            return false;
        }

        setLoadingOlder(true);

        try {
            const page = await fetchMessagesBefore(current.id, olderCursor);
            setHistory((list) => [
                ...page.data.filter(
                    (older) => !list.some((message) => message.id === older.id),
                ),
                ...list,
            ]);
            setOlderCursor(page.next_before_sequence);

            return true;
        } catch (caught) {
            return fail(caught);
        } finally {
            setLoadingOlder(false);
        }
    };

    const rename = async (
        target: Conversation,
        title: string,
    ): Promise<string | null> => {
        try {
            const updated = await sidebar.rename(target.id, title);

            if (updated.id === current?.id) {
                setCurrent(updated);
            }

            setAnnouncement('Conversation renamed.');

            return null;
        } catch (caught) {
            return errorMessage(caught);
        }
    };

    const displayed: DisplayMessage[] = [
        ...history.map((message) => ({
            key: message.id,
            role: message.role,
            content: message.content,
            pending: false,
        })),
        ...(pending === null
            ? []
            : [
                  {
                      key: 'pending',
                      role: 'user' as const,
                      content: pending,
                      pending: true,
                  },
              ]),
    ];
    const title = current?.title ?? 'New chat';

    return (
        <AppShell variant="sidebar">
            <Head title={title} />
            <ChatSidebar
                conversations={sidebar}
                activeId={current?.id ?? null}
                onRename={setRenaming}
            />
            <SidebarInset className="h-dvh min-h-0 overflow-hidden peer-data-[variant=inset]:min-h-0 md:peer-data-[variant=inset]:h-[calc(100dvh-1rem)]">
                <ChatHeader
                    title={title}
                    onRename={current ? () => setRenaming(current) : undefined}
                />
                <ChatMessageList
                    messages={displayed}
                    hasOlder={olderCursor !== null}
                    loadingOlder={loadingOlder}
                    onLoadOlder={loadOlder}
                    empty={
                        <>
                            <MessageSquare className="mb-3 size-8 text-muted-foreground" />
                            <h2 className="text-lg font-medium">
                                {current
                                    ? 'No messages yet'
                                    : 'Start a conversation'}
                            </h2>
                            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                                Your messages are saved to this conversation.
                                Assistant replies arrive in a later update.
                            </p>
                        </>
                    }
                />
                <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
                    <ChatComposer
                        onSend={send}
                        sending={pending !== null}
                        error={error}
                    />
                </div>
                <div role="status" aria-live="polite" className="sr-only">
                    {announcement}
                </div>
            </SidebarInset>
            <RenameConversationDialog
                conversation={renaming}
                onClose={() => setRenaming(null)}
                onSave={rename}
            />
        </AppShell>
    );
}
