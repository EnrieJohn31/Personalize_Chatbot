import { Head, router } from '@inertiajs/react';
import { MessageSquare, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import { AppShell } from '@/components/app-shell';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatHeader } from '@/components/chat/chat-header';
import type {
    DisplayMessage,
    MessageStatus,
} from '@/components/chat/chat-message';
import { ChatMessageList } from '@/components/chat/chat-message-list';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { RenameConversationDialog } from '@/components/chat/rename-conversation-dialog';
import { Button } from '@/components/ui/button';
import { SidebarInset } from '@/components/ui/sidebar';
import { useChatRun } from '@/hooks/use-chat-run';
import { useConversations } from '@/hooks/use-conversations';
import {
    ChatApiError,
    appendMessage,
    createConversation,
    fetchMessagesBefore,
} from '@/lib/chat-api';
import { titleFromMessage } from '@/lib/chat-composer';
import type { RunStatus } from '@/lib/chat-run-state';
import { isResponding } from '@/lib/chat-run-state';
import type { ChatMessage, ChatPageProps, Conversation } from '@/types';

const errorMessage = (caught: unknown): string =>
    caught instanceof ChatApiError
        ? caught.message
        : 'Something went wrong. Try again.';

/** How an unsaved reply is labelled in the transcript, by run status. */
const draftStatus: Partial<Record<RunStatus, MessageStatus>> = {
    starting: 'preparing',
    streaming: 'streaming',
    stopping: 'streaming',
    cancelled: 'stopped',
    failed: 'incomplete',
};

/** Screen-reader announcements for reply progress; never the reply text itself. */
const runAnnouncements: Partial<Record<RunStatus, string>> = {
    starting: 'Starting a reply.',
    streaming: 'The assistant is replying.',
    stopping: 'Stopping the reply.',
    completed: 'Reply complete.',
    cancelled: 'Reply stopped.',
};

export default function ChatPage({
    conversations,
    conversation,
    messages,
    active_run: activeRun,
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

    const reply = useChatRun((saved) => {
        // The saved reply replaces the streamed draft in one render.
        setHistory((list) =>
            list.some((message) => message.id === saved.id)
                ? list
                : [...list, saved],
        );
        if (current !== null) {
            sidebar.moveToTop({ ...current, updated_at: saved.created_at });
        }
    });
    const { status } = reply.state;
    const responding = isResponding(status);

    // Resume a reply that is still being written, after a reload or a new conversation's first message.
    const resumableRunId =
        activeRun !== null && activeRun.conversation_id === conversation?.id
            ? activeRun.id
            : null;
    useEffect(() => {
        if (resumableRunId !== null && activeRun !== null) {
            reply.follow(activeRun);
        }
        // Only the run's identity matters; the page remounts on navigation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resumableRunId]);

    const fail = (caught: unknown): false => {
        const message = errorMessage(caught);
        setError(message);
        setAnnouncement(message);

        return false;
    };

    const requestReply = async (conversationId: string): Promise<void> => {
        const run = await reply.start(conversationId);

        if (run !== null) {
            reply.follow(run);
        }
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
                // Start the reply, then open the conversation's own address, which resumes the
                // stream. If starting fails, that page offers "Get a reply" for the saved message.
                await reply.start(target.id);
                router.visit(ChatPageController.show.url(target.id));

                return true;
            }

            setHistory((list) => [...list, saved]);
            sidebar.moveToTop({ ...target, updated_at: saved.created_at });
            setAnnouncement('Message sent.');
            setPending(null);
            await requestReply(target.id);

            return true;
        } catch (caught) {
            return fail(caught);
        } finally {
            setPending(null);
        }
    };

    const retry = (): void => {
        setError(null);

        if (reply.state.resumable && reply.state.run !== null) {
            reply.follow(reply.state.run);
        } else if (current !== null) {
            void requestReply(current.id);
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

    const draft = draftStatus[status];
    // Only a reply for this conversation is shown, and a stopped or failed one only if text arrived.
    const replyHere =
        reply.state.run === null ||
        reply.state.run.conversation_id === current?.id;
    const showDraft =
        draft !== undefined &&
        replyHere &&
        (responding || reply.state.draft !== '');
    const displayed: DisplayMessage[] = [
        ...history.map((message) => ({
            key: message.id,
            role: message.role,
            content: message.content,
            status: null,
        })),
        ...(pending === null
            ? []
            : [
                  {
                      key: 'pending',
                      role: 'user' as const,
                      content: pending,
                      status: 'sending' as const,
                  },
              ]),
        ...(showDraft && draft !== undefined
            ? [
                  {
                      key: 'draft',
                      role: 'assistant' as const,
                      content: reply.state.draft,
                      status: draft,
                  },
              ]
            : []),
    ];
    // A saved user message without a reply can always ask for one again.
    const awaitingReply =
        current !== null &&
        !responding &&
        pending === null &&
        history.at(-1)?.role === 'user';
    const replyError = status === 'failed' ? reply.state.error : null;
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
                                Messages are saved to this conversation, and
                                replies appear as they are written.
                            </p>
                        </>
                    }
                />
                <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
                    {reply.state.reconnecting && (
                        <p className="text-center text-xs text-muted-foreground">
                            Connection interrupted. Reconnecting…
                        </p>
                    )}
                    {awaitingReply && (
                        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                            {replyError && (
                                <span role="alert" className="text-destructive">
                                    {replyError}
                                </span>
                            )}
                            <Button variant="outline" size="sm" onClick={retry}>
                                <RotateCw />
                                {replyError ? 'Retry reply' : 'Get a reply'}
                            </Button>
                        </div>
                    )}
                    <ChatComposer
                        onSend={send}
                        sending={pending !== null}
                        responding={responding}
                        stopping={status === 'stopping'}
                        onStop={() => void reply.stop()}
                        error={
                            error ??
                            (status === 'stopping' || status === 'streaming'
                                ? reply.state.error
                                : null)
                        }
                    />
                </div>
                <div role="status" aria-live="polite" className="sr-only">
                    {runAnnouncements[status] ?? announcement}
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
