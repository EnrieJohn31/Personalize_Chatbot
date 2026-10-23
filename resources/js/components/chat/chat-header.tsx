import { Pencil } from 'lucide-react';
import { AppearanceMenu } from '@/components/appearance-menu';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = {
    title: string;
    onRename?: () => void;
};

export function ChatHeader({ title, onRename }: Props) {
    return (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border/50 px-3 md:px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
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
                <AppearanceMenu />
            </div>
        </header>
    );
}
