import { Head, usePoll } from '@inertiajs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { AdminPage } from '@/components/admin-page';
import { ChatChoice } from '@/components/connections/chat-choice';
import { FormActivityContext } from '@/components/connections/form-activity';
import {
    ProviderCard,
    isSigningIn,
} from '@/components/connections/provider-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionsOverview } from '@/types';

export default function Connections({
    connections,
}: {
    connections: ConnectionsOverview;
}) {
    const { engine, providers, chat } = connections;
    const available = engine === 'available';
    const signingIn = providers.some(isSigningIn);
    const connected = providers.filter((card) => card.status === 'connected');
    const [submitting, setSubmitting] = useState(0);

    // While a ChatGPT sign-in runs, reload only this prop so the page notices the browser
    // finishing it. Polling pauses while any form submits, so no reload races its answer.
    const { start, stop } = usePoll(
        2000,
        { only: ['connections'] },
        { autoStart: false, mode: 'rest' },
    );
    useEffect(() => {
        if (!signingIn || submitting > 0) {
            return;
        }

        start();

        return stop;
    }, [signingIn, submitting, start, stop]);

    const activity = {
        onStart: () => setSubmitting((count) => count + 1),
        onFinish: () => setSubmitting((count) => Math.max(0, count - 1)),
    };

    return (
        <FormActivityContext.Provider value={activity}>
            <Head title="Connections" />

            <AdminPage
                title="Connections"
                description="Connect your AI accounts, then choose a default model for new conversations."
            >
                {!available && (
                    <Alert>
                        <TriangleAlert />
                        <AlertTitle>
                            {engine === 'not_configured'
                                ? 'Connections are not set up on this server'
                                : 'The assistant engine is not reachable'}
                        </AlertTitle>
                        <AlertDescription>
                            {engine === 'not_configured'
                                ? 'An administrator needs to set AGENT_CREDENTIAL_KEY and restart the engine.'
                                : 'Try again in a moment. If this keeps happening, check that the engine container is running.'}
                        </AlertDescription>
                    </Alert>
                )}

                <ChatChoice
                    key={`${chat?.provider ?? ''}:${chat?.model ?? ''}:${connected.map((card) => card.provider).join()}`}
                    chat={chat}
                    connected={connected}
                    disabled={!available}
                />

                <section
                    aria-labelledby="providers-heading"
                    className="space-y-5"
                >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="space-y-1">
                            <h2
                                id="providers-heading"
                                className="text-base font-semibold"
                            >
                                Your providers
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Sign-ins and API keys are stored encrypted on
                                this server.
                            </p>
                        </div>
                        {available && (
                            <p className="text-xs text-muted-foreground">
                                {connected.length} of {providers.length}{' '}
                                connected
                            </p>
                        )}
                    </div>
                    <div className="grid items-start gap-5 xl:grid-cols-2">
                        {providers.map((card) => (
                            <ProviderCard
                                key={card.provider}
                                card={card}
                                available={available}
                            />
                        ))}
                    </div>
                </section>
            </AdminPage>
        </FormActivityContext.Provider>
    );
}

Connections.layout = {
    breadcrumbs: [
        {
            title: 'Connections',
            href: ConnectionsController.index(),
        },
    ],
};
