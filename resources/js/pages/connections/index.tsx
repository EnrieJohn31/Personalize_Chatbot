import { Head, usePoll } from '@inertiajs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { ChatChoice } from '@/components/connections/chat-choice';
import { FormActivityContext } from '@/components/connections/form-activity';
import {
    ProviderCard,
    isSigningIn,
} from '@/components/connections/provider-card';
import Heading from '@/components/heading';
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

            <div className="w-full max-w-3xl space-y-6 px-4 py-6">
                <Heading
                    title="Connections"
                    description="Connect your own AI accounts and choose which one chat uses. Every sign-in and key stays encrypted on this server and is never sent back to your browser."
                />

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

                {providers.map((card) => (
                    <ProviderCard
                        key={card.provider}
                        card={card}
                        available={available}
                    />
                ))}
            </div>
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
