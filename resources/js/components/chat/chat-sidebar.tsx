import { Link } from '@inertiajs/react';
import {
    Cable,
    MessageSquare,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import AppLogo from '@/components/app-logo';
import { NavUser } from '@/components/nav-user';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { groupConversations } from '@/lib/conversation-groups';
import { dashboard } from '@/routes';
import type { Conversation } from '@/types';

/** Selection for deleting several conversations at once; `null` while not selecting. */
export type ConversationSelection = {
    ids: string[];
    toggle: (id: string) => void;
    setAll: (ids: string[]) => void;
};

type Props = {
    conversations: UseConversationsReturn;
    activeId: string | null;
    onRename: (conversation: Conversation) => void;
    onDelete: (conversations: Conversation[]) => void;
    selection: ConversationSelection | null;
    onSelecting: (selecting: boolean) => void;
};

export function ChatSidebar({
    conversations,
    activeId,
    onRename,
    onDelete,
    selection,
    onSelecting,
}: Props) {
    const groups = groupConversations(conversations.items);
    const selected = conversations.items.filter((conversation) =>
        selection?.ids.includes(conversation.id),
    );
    const allSelected =
        selected.length > 0 && selected.length === conversations.items.length;

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
                <div className="flex items-center justify-between px-4 pt-2">
                    <h2 className="text-xs font-medium text-sidebar-foreground/70">
                        Conversations
                    </h2>
                    {conversations.items.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-pressed={selection !== null}
                            onClick={() => onSelecting(selection === null)}
                        >
                            {selection === null ? 'Select' : 'Done'}
                        </Button>
                    )}
                </div>

                {conversations.items.length === 0 && (
                    <p className="px-4 py-1 text-sm text-muted-foreground">
                        No conversations yet.
                    </p>
                )}

                {groups.map((group) => (
                    <SidebarGroup key={group.label} className="py-1">
                        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {group.conversations.map((conversation) =>
                                    selection === null ? (
                                        <ConversationItem
                                            key={conversation.id}
                                            conversation={conversation}
                                            active={
                                                conversation.id === activeId
                                            }
                                            onRename={onRename}
                                            onDelete={onDelete}
                                        />
                                    ) : (
                                        <SelectableItem
                                            key={conversation.id}
                                            conversation={conversation}
                                            checked={selection.ids.includes(
                                                conversation.id,
                                            )}
                                            onToggle={selection.toggle}
                                        />
                                    ),
                                )}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ))}

                <div className="px-2">
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
                </div>
            </SidebarContent>

            <SidebarFooter>
                {selection !== null ? (
                    <div
                        role="region"
                        aria-label="Selected conversations"
                        className="space-y-2 rounded-md border bg-sidebar-accent/40 p-2"
                    >
                        <div className="flex items-center justify-between gap-2 text-sm">
                            <span aria-live="polite">
                                {selected.length} selected
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                    selection.setAll(
                                        allSelected
                                            ? []
                                            : conversations.items.map(
                                                  ({ id }) => id,
                                              ),
                                    )
                                }
                            >
                                {allSelected ? 'Clear' : 'Select all'}
                            </Button>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            disabled={selected.length === 0}
                            onClick={() => onDelete(selected)}
                        >
                            <Trash2 />
                            Delete selected
                        </Button>
                    </div>
                ) : (
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild>
                                <Link href={ConnectionsController.index()}>
                                    <Cable />
                                    <span>Connections</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                )}
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}

function ConversationItem({
    conversation,
    active,
    onRename,
    onDelete,
}: {
    conversation: Conversation;
    active: boolean;
    onRename: Props['onRename'];
    onDelete: Props['onDelete'];
}) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active}>
                <Link
                    href={ChatPageController.show(conversation.id)}
                    aria-current={active ? 'page' : undefined}
                >
                    <MessageSquare />
                    <span>{conversation.title}</span>
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
                <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem onSelect={() => onRename(conversation)}>
                        <Pencil />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onDelete([conversation])}
                    >
                        <Trash2 />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </SidebarMenuItem>
    );
}

function SelectableItem({
    conversation,
    checked,
    onToggle,
}: {
    conversation: Conversation;
    checked: boolean;
    onToggle: (id: string) => void;
}) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={checked}>
                {/* The label forwards clicks on the title to the checkbox. */}
                <label className="cursor-pointer">
                    <Checkbox
                        checked={checked}
                        onCheckedChange={() => onToggle(conversation.id)}
                        aria-label={`Select ${conversation.title}`}
                    />
                    <span>{conversation.title}</span>
                </label>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}
