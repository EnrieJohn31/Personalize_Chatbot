import { ArrowUp, Square } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    MAX_MESSAGE_LENGTH,
    canSend,
    characterCount,
    shouldSendOnKeyDown,
} from '@/lib/chat-composer';
import { cn } from '@/lib/utils';

/** Height, in pixels, after which the draft scrolls instead of growing. */
const MAX_HEIGHT = 240;

type Props = {
    /** Resolves true once the message is saved; false restores the draft. */
    onSend: (content: string) => Promise<boolean>;
    sending: boolean;
    /** A reply is in progress: the send button becomes Stop. */
    responding: boolean;
    stopping: boolean;
    onStop: () => void;
    error: string | null;
};

export function ChatComposer({
    onSend,
    sending,
    responding,
    stopping,
    onStop,
    error,
}: Props) {
    const [draft, setDraft] = useState('');
    const textarea = useRef<HTMLTextAreaElement>(null);
    const composing = useRef(false);
    const count = characterCount(draft);
    const tooLong = count > MAX_MESSAGE_LENGTH;
    const ready = canSend(draft) && !sending && !responding;

    useLayoutEffect(() => {
        const element = textarea.current;

        if (element) {
            element.style.height = 'auto';
            element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
        }
    }, [draft]);

    const submit = async (): Promise<void> => {
        if (!ready) {
            return;
        }

        const content = draft;
        setDraft('');

        if (!(await onSend(content))) {
            // Restore the failed text unless the person has started a new draft.
            setDraft((current) => (current === '' ? content : current));
        }

        textarea.current?.focus();
    };

    return (
        <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div className="rounded-2xl border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <label htmlFor="chat-composer" className="sr-only">
                    Message
                </label>
                <Textarea
                    id="chat-composer"
                    ref={textarea}
                    rows={1}
                    value={draft}
                    placeholder="Write a message"
                    enterKeyHint="send"
                    aria-describedby="chat-composer-hint"
                    aria-invalid={tooLong || undefined}
                    className="max-h-60 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    onChange={(event) => setDraft(event.target.value)}
                    onCompositionStart={() => {
                        composing.current = true;
                    }}
                    onCompositionEnd={() => {
                        composing.current = false;
                    }}
                    onKeyDown={(event) => {
                        if (
                            shouldSendOnKeyDown(
                                event.nativeEvent,
                                composing.current,
                            )
                        ) {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                />
                <div className="flex items-center justify-end gap-2 px-2 pb-2">
                    {count > MAX_MESSAGE_LENGTH * 0.9 && (
                        <span
                            className={cn(
                                'text-xs tabular-nums',
                                tooLong
                                    ? 'text-destructive'
                                    : 'text-muted-foreground',
                            )}
                        >
                            {count.toLocaleString()} /{' '}
                            {MAX_MESSAGE_LENGTH.toLocaleString()}
                        </span>
                    )}
                    {stopping ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled
                        >
                            Stopping…
                        </Button>
                    ) : responding ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    className="size-8 rounded-full"
                                    aria-label="Stop response"
                                    onClick={onStop}
                                >
                                    <Square className="fill-current" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Stop</TooltipContent>
                        </Tooltip>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="submit"
                                    size="icon"
                                    className="size-8 rounded-full"
                                    disabled={!ready}
                                    aria-label="Send message"
                                >
                                    <ArrowUp />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Send (Enter)</TooltipContent>
                        </Tooltip>
                    )}
                </div>
            </div>
            <p
                id="chat-composer-hint"
                className="px-1 text-center text-xs text-muted-foreground"
            >
                Enter sends, Shift+Enter adds a line.
            </p>
            {error && (
                <p
                    role="alert"
                    className="px-1 text-center text-sm text-destructive"
                >
                    {error}
                </p>
            )}
        </form>
    );
}
