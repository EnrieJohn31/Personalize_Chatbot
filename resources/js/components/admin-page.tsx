import type { ReactNode } from 'react';

export function AdminPage({
    title,
    description,
    actions,
    children,
}: {
    title: string;
    description: string;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="mx-auto w-full max-w-6xl space-y-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl space-y-2">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                        {title}
                    </h1>
                    <p className="text-sm leading-6 text-muted-foreground">
                        {description}
                    </p>
                </div>
                {actions}
            </header>
            {children}
        </div>
    );
}
