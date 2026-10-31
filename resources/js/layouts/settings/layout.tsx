import { Link } from '@inertiajs/react';
import { Palette, ShieldCheck, UserRound } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { AdminPage } from '@/components/admin-page';
import { useCurrentUrl } from '@/hooks/use-current-url';
import { cn } from '@/lib/utils';
import { edit as appearance } from '@/routes/appearance';
import { edit as profile } from '@/routes/profile';
import { edit as security } from '@/routes/security';

const sections = [
    {
        title: 'Profile',
        href: profile(),
        icon: UserRound,
        description: 'Keep your personal details up to date.',
    },
    {
        title: 'Security',
        href: security(),
        icon: ShieldCheck,
        description: 'Control how you sign in and protect your account.',
    },
    {
        title: 'Appearance',
        href: appearance(),
        icon: Palette,
        description: 'Choose a look that feels comfortable to you.',
    },
];

export default function SettingsLayout({ children }: PropsWithChildren) {
    const { isCurrentUrl } = useCurrentUrl();
    const current =
        sections.find((item) => isCurrentUrl(item.href)) ?? sections[0];

    return (
        <AdminPage title={current.title} description={current.description}>
            <div className="max-w-4xl">
                <nav
                    aria-label="Settings"
                    className="mb-8 flex gap-1 border-b sm:gap-6"
                >
                    {sections.map(({ title, href, icon: Icon }) => {
                        const active = isCurrentUrl(href);
                        return (
                            <Link
                                key={title}
                                href={href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'flex min-h-11 items-center gap-2 border-b-2 px-2 pb-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    active
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                                )}
                            >
                                <Icon
                                    aria-hidden="true"
                                    className="hidden size-4 sm:block"
                                />
                                {title}
                            </Link>
                        );
                    })}
                </nav>
                <div className="settings-content space-y-8">{children}</div>
            </div>
        </AdminPage>
    );
}
