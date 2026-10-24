import { Link } from '@inertiajs/react';
import { Pencil, Trash2, TriangleAlert } from 'lucide-react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { AppearanceMenu } from '@/components/appearance-menu';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChatAssistant } from '@/types';

type Props = {
    title: string;
    assistant: ChatAssistant;
    onRename?: () => void;
    onDelete?: () => void;
};

export function ChatHeader({ title, assistant, onRename, onDelete }: Props) {
    return (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border/50 px-3 md:px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
            <AssistantLabel assistant={assistant} />
            <div className="ml-auto flex shrink-0 items-center gap-1">
                {onRename && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Rename conversation"
                                onClick={onRename}
                            >
                                <Pencil />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Rename</TooltipContent>
                    </Tooltip>
                )}
                {onDelete && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete conversation"
                                onClick={onDelete}
                            >
                                <Trash2 />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                )}
                <AppearanceMenu />
            </div>
        </header>
    );
}

/** Which account and model answer here; links to Connections, where the choice for new chats is made. */
function AssistantLabel({ assistant }: { assistant: ChatAssistant }) {
    const label =
        assistant.model === null
            ? assistant.name
            : `${assistant.name} · ${assistant.model}`;
    const note = !assistant.ready
        ? assistant.provider === 'local'
            ? `${assistant.name} is not answering. Open Connections to check it.`
            : `${assistant.name} is not connected. Open Connections to fix it.`
        : assistant.provider !== null && !assistant.live
          ? 'Replies still come from the built-in assistant until live replies are turned on.'
          : 'New chats use the model chosen on the Connections page.';

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Link
                    href={ConnectionsController.index()}
                    className={cn(
                        'inline-flex max-w-[45%] min-w-0 shrink items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                        assistant.ready
                            ? 'text-muted-foreground hover:text-foreground'
                            : 'border-amber-500/60 text-amber-700 dark:text-amber-400',
                    )}
                >
                    {!assistant.ready && (
                        <TriangleAlert className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{label}</span>
                    <span className="sr-only">. {note}</span>
                </Link>
            </TooltipTrigger>
            <TooltipContent>{note}</TooltipContent>
        </Tooltip>
    );
}
