import { Link } from '@inertiajs/react';
import {
    Cable,
    LayoutGrid,
    MessageSquare,
    Palette,
    ShieldCheck,
    UserRound,
} from 'lucide-react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import AppLogo from '@/components/app-logo';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { dashboard } from '@/routes';
import { edit as appearance } from '@/routes/appearance';
import { edit as profile } from '@/routes/profile';
import { edit as security } from '@/routes/security';
import type { NavItem } from '@/types';

const mainNavItems: NavItem[] = [
    {
        title: 'Overview',
        href: dashboard(),
        icon: LayoutGrid,
    },
    {
        title: 'Chat',
        href: ChatPageController.index(),
        icon: MessageSquare,
    },
    {
        title: 'Connections',
        href: ConnectionsController.index(),
        icon: Cable,
    },
];

const settingsNavItems: NavItem[] = [
    {
        title: 'Profile',
        href: profile(),
        icon: UserRound,
    },
    {
        title: 'Security',
        href: security(),
        icon: ShieldCheck,
    },
    {
        title: 'Appearance',
        href: appearance(),
        icon: Palette,
    },
];

export function AppSidebar() {
    return (
        <Sidebar collapsible="icon" variant="sidebar">
            <SidebarHeader className="px-3 py-5">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={dashboard()} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="gap-5">
                <nav aria-label="Workspace navigation">
                    <NavMain items={mainNavItems} />
                </nav>
                <nav aria-label="Account settings">
                    <NavMain
                        items={settingsNavItems}
                        label="Account settings"
                    />
                </nav>
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border p-3">
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
