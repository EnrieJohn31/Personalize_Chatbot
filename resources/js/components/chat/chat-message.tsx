import { Check, CircleAlert, Copy } from 'lucide-react';
import { useState } from 'react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useClipboard } from '@/hooks/use-clipboard';
import { cn } from '@/lib/utils';
import type { ChatRole } from '@/types';

/** Unsaved states shown in the transcript; saved messages have no status. */
export type MessageStatus =
    | 'sending'
    | 'preparing'
    | 'retrieving'
    | 'streaming'
    | 'stopped'
    | 'incomplete';

export type DisplayMessage = {
    key: string;
    role: ChatRole;
    content: string;
    status: MessageStatus | null;
    /** The model that wrote a saved reply, shown beside its actions. */
    model?: string | null;
};

const statusLabels: Record<MessageStatus, string> = {
    sending: 'Sending…',
    preparing: 'Preparing a reply…',
    retrieving: 'Looking up references…',
    streaming: 'Writing…',
    stopped: 'Stopped',
    incomplete: 'Not completed',
};

export function ChatMessageItem({ message }: { message: DisplayMessage }) {
    const isUser = message.role === 'user';
    const inProgress =
        message.status === 'sending' ||
        message.status === 'preparing' ||
        message.status === 'retrieving' ||
        message.status === 'streaming';
    const actions = (
        <div
            className={cn(
                'flex shrink-0 items-center transition-opacity',
                message.status === null &&
                    'opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 md:opacity-0',
            )}
        >
            {message.status === null ? (
                <>
                    <CopyMessageButton content={message.content} />
                    {!isUser && message.model && (
                        <span className="px-1 text-xs text-muted-foreground">
                            <span className="sr-only">Written by </span>
                            {message.model}
                        </span>
                    )}
                </>
            ) : (
                <span className="px-2 text-xs text-muted-foreground">
                    {statusLabels[message.status]}
                </span>
            )}
        </div>
    );

    return (
        <li
            className={cn(
                'group flex gap-1',
                // Actions sit beside a user's bubble and below an assistant reply.
                isUser ? 'items-center justify-end' : 'flex-col items-start',
            )}
        >
            {isUser && actions}
            <div
                className={cn(
                    'min-w-0 text-sm leading-relaxed break-words',
                    // A person's text is shown exactly; assistant replies are Markdown.
                    isUser
                        ? 'max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap text-foreground'
                        : 'w-full max-w-full',
                    message.status === 'sending' && 'opacity-70',
                    (message.status === 'stopped' ||
                        message.status === 'incomplete') &&
                        'text-muted-foreground',
                )}
                aria-busy={inProgress || undefined}
            >
                <span className="sr-only">
                    {isUser ? 'You said:' : 'Assistant said:'}
                </span>
                {isUser ? (
                    message.content
                ) : message.content === '' ? (
                    <span className="inline-flex gap-1 py-2" aria-hidden="true">
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                    </span>
                ) : (
                    <MarkdownContent text={message.content} />
                )}
            </div>
            {!isUser && <div className="-ml-2">{actions}</div>}
        </li>
    );
}

type CopyState = 'idle' | 'copied' | 'failed';

const copyLabels: Record<CopyState, { label: string; tip: string }> = {
    idle: { label: 'Copy message', tip: 'Copy' },
    copied: { label: 'Message copied', tip: 'Copied' },
    failed: { label: 'Copy failed', tip: 'Copying is not available here' },
};

function CopyMessageButton({ content }: { content: string }) {
    const [, copy] = useClipboard();
    const [state, setState] = useState<CopyState>('idle');
    const Icon =
        state === 'copied' ? Check : state === 'failed' ? CircleAlert : Copy;

    const handleCopy = async (): Promise<void> => {
        setState((await copy(content)) ? 'copied' : 'failed');
        window.setTimeout(() => setState('idle'), 2000);
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'size-7 text-muted-foreground',
                        state === 'failed' && 'text-destructive',
                    )}
                    aria-label={copyLabels[state].label}
                    onClick={() => void handleCopy()}
                >
                    <Icon />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{copyLabels[state].tip}</TooltipContent>
        </Tooltip>
    );
}
