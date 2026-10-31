import { Link } from '@inertiajs/react';
import { ArrowUpRight } from 'lucide-react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import type { BreadcrumbItem as BreadcrumbItemType } from '@/types';

export function AppSidebarHeader({
    breadcrumbs = [],
}: {
    breadcrumbs?: BreadcrumbItemType[];
}) {
    return (
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-card px-5 sm:px-8">
            <a
                href="#main-content"
                className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:z-50"
            >
                Skip to content
            </a>
            <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="-ml-1" />
                <Breadcrumbs breadcrumbs={breadcrumbs} />
            </div>
            <Button
                asChild
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground"
            >
                <Link href={ChatPageController.index()}>
                    Open chat{' '}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
            </Button>
        </header>
    );
}
