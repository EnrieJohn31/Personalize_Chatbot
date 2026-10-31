import { Head, Link } from '@inertiajs/react';
import {
    ArrowRight,
    Cable,
    MessageSquare,
    Palette,
    ShieldCheck,
    UserRound,
} from 'lucide-react';
import ChatPageController from '@/actions/App/Http/Controllers/ChatPageController';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { AdminPage } from '@/components/admin-page';
import { Button } from '@/components/ui/button';
import { dashboard } from '@/routes';
import { edit as appearance } from '@/routes/appearance';
import { edit as profile } from '@/routes/profile';
import { edit as security } from '@/routes/security';

const settings = [
    {
        title: 'Connections',
        description:
            'Connect an AI account and choose the model for new chats.',
        href: ConnectionsController.index(),
        icon: Cable,
    },
    {
        title: 'Profile',
        description: 'Update your name and email address.',
        href: profile(),
        icon: UserRound,
    },
    {
        title: 'Security',
        description:
            'Manage your password, two-factor authentication and passkeys.',
        href: security(),
        icon: ShieldCheck,
    },
    {
        title: 'Appearance',
        description: 'Choose a light, dark or system theme.',
        href: appearance(),
        icon: Palette,
    },
];

export default function Dashboard() {
    return (
        <>
            <Head title="Overview" />
            <AdminPage
                title="Your workspace"
                description="A simple place to manage your assistant and account."
            >
                <section
                    aria-labelledby="chat-heading"
                    className="flex flex-col gap-6 rounded-xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
                >
                    <div className="flex items-start gap-4">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                            <MessageSquare
                                className="size-5"
                                aria-hidden="true"
                            />
                        </div>
                        <div className="space-y-2">
                            <h2
                                id="chat-heading"
                                className="text-lg font-semibold"
                            >
                                Ready when you are
                            </h2>
                            <p className="max-w-md text-sm leading-6 text-muted-foreground">
                                Start a conversation or pick up where you left
                                off. Your saved chats are one click away.
                            </p>
                        </div>
                    </div>
                    <Button
                        asChild
                        className="shrink-0 self-start sm:self-center"
                    >
                        <Link href={ChatPageController.index()}>
                            Go to chat <ArrowRight aria-hidden="true" />
                        </Link>
                    </Button>
                </section>

                <section aria-labelledby="settings-heading">
                    <div className="mb-4 space-y-1">
                        <h2
                            id="settings-heading"
                            className="text-base font-semibold"
                        >
                            Make it yours
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Everything you need to set up your workspace.
                        </p>
                    </div>
                    <div className="divide-y rounded-xl border bg-card">
                        {settings.map(
                            ({ title, description, href, icon: Icon }) => (
                                <Link
                                    key={title}
                                    href={href}
                                    className="group flex items-center gap-4 p-5 outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
                                >
                                    <Icon
                                        aria-hidden="true"
                                        className="size-5 shrink-0 text-muted-foreground group-hover:text-primary"
                                    />
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <h3 className="text-sm font-semibold">
                                            {title}
                                        </h3>
                                        <p className="text-sm leading-5 text-muted-foreground">
                                            {description}
                                        </p>
                                    </div>
                                    <ArrowRight
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                </Link>
                            ),
                        )}
                    </div>
                </section>
            </AdminPage>
        </>
    );
}

Dashboard.layout = { breadcrumbs: [{ title: 'Overview', href: dashboard() }] };
