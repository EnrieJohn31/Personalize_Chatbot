import { Link } from '@inertiajs/react';
import { MessageSquare, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import AppLogo from '@/components/app-logo';
import { NavUser } from '@/components/nav-user';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import type { UseConversationsReturn } from '@/hooks/use-conversations';
import { dashboard } from '@/routes';
import type { Conversation } from '@/types';

type Props = {
    conversations: UseConversationsReturn;
    activeId: string | null;
    onRename: (conversation: Conversation) => void;
};

export function ChatSidebar({ conversations, activeId, onRename }: Props) {
    return (
        <Sidebar collapsible="offcanvas" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={dashboard()} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                <Button asChild variant="outline" className="justify-start">
                    <Link href={ChatPageController.index()}>
                        <Plus />
                        New chat
                    </Link>
                </Button>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Conversations</SidebarGroupLabel>
                    <SidebarGroupContent>
                        {conversations.items.length === 0 ? (
                            <p className="px-2 py-1 text-sm text-muted-foreground">
                                No conversations yet.
                            </p>
                        ) : (
                            <SidebarMenu>
                                {conversations.items.map((conversation) => (
                                    <SidebarMenuItem key={conversation.id}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={
                                                conversation.id === activeId
                                            }
                                        >
                                            <Link
                                                href={ChatPageController.show(
                                                    conversation.id,
                                                )}
                                                aria-current={
                                                    conversation.id === activeId
                                                        ? 'page'
                                                        : undefined
                                                }
                                            >
                                                <MessageSquare />
                                                <span>
                                                    {conversation.title}
                                                </span>
                                            </Link>
                                        </SidebarMenuButton>
                                        <DropdownMenu modal={false}>
                                            <DropdownMenuTrigger asChild>
                                                <SidebarMenuAction
                                                    showOnHover
                                                    aria-label={`Actions for ${conversation.title}`}
                                                >
                                                    <MoreHorizontal />
                                                </SidebarMenuAction>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                                side="right"
                                                align="start"
                                            >
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        onRename(conversation)
                                                    }
                                                >
                                                    <Pencil />
                                                    Rename
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        )}

                        {conversations.error && (
                            <p
                                role="alert"
                                className="px-2 py-1 text-sm text-destructive"
                            >
                                {conversations.error}
                            </p>
                        )}

                        {conversations.hasMore && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 w-full justify-start text-muted-foreground"
                                disabled={conversations.loadingMore}
                                onClick={() => void conversations.loadMore()}
                            >
                                {conversations.loadingMore && <Spinner />}
                                Show more conversations
                            </Button>
                        )}
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
