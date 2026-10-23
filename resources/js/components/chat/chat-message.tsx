import { Check, CircleAlert, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useClipboard } from '@/hooks/use-clipboard';
import { cn } from '@/lib/utils';
import type { ChatRole } from '@/types';

export type DisplayMessage = {
    key: string;
    role: ChatRole;
    content: string;
    pending: boolean;
};

export function ChatMessageItem({ message }: { message: DisplayMessage }) {
    const isUser = message.role === 'user';
    const actions = (
        <div className="flex shrink-0 items-center opacity-100 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
            {message.pending ? (
                <span className="px-2 text-xs text-muted-foreground">
                    Sending…
                </span>
            ) : (
                <CopyMessageButton content={message.content} />
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
                    // Plain text keeps indentation and line breaks; Markdown arrives with task 2.4.
                    'min-w-0 text-sm leading-relaxed break-words whitespace-pre-wrap',
                    isUser
                        ? 'max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-foreground'
                        : 'max-w-full',
                    message.pending && 'opacity-70',
                )}
            >
                <span className="sr-only">
                    {isUser ? 'You said:' : 'Assistant said:'}
                </span>
                {message.content}
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
