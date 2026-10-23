import { TriangleAlert } from 'lucide-react';
import { ApiKeyForm } from '@/components/connections/api-key-form';
import {
    ChatGptSignInSteps,
    ChatGptStart,
} from '@/components/connections/chatgpt-sign-in';
import { ConnectedTools } from '@/components/connections/connected-tools';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { ConnectionProviderId, ProviderConnectionCard } from '@/types';

/** States in which a ChatGPT sign-in can still finish; the page polls while one is shown. */
export const ACTIVE_SIGN_IN_STATES = [
    'starting',
    'waiting_for_user',
    'exchanging',
];

export const isSigningIn = (card: ProviderConnectionCard): boolean =>
    card.login !== null && ACTIVE_SIGN_IN_STATES.includes(card.login.state);

const SUMMARIES: Record<ConnectionProviderId, string> = {
    openai: "Sign in with your ChatGPT account, for example a Plus or Pro plan. OpenAI decides during sign-in whether your plan can be used here, and replies count toward your plan's usage.",
    'opencode-go':
        "OpenCode's subscription for open models. Paste your OpenCode API key; replies count toward your Go subscription.",
    opencode:
        "OpenCode's pay-as-you-go gateway to many models. Paste your OpenCode API key; replies are charged to your Zen balance, except on free models.",
};

export function ProviderCard({
    card,
    available,
}: {
    card: ProviderConnectionCard;
    /** False while the engine cannot be asked; the page explains why. */
    available: boolean;
}) {
    const signingIn = isSigningIn(card);
    const headingId = `${card.provider}-heading`;

    return (
        <section
            aria-labelledby={headingId}
            className="space-y-4 rounded-lg border p-4 sm:p-5"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={headingId} className="font-medium">
                    {card.name}
                </h2>
                <StatusBadge card={card} signingIn={signingIn} />
            </div>

            <p className="text-sm text-muted-foreground">
                {SUMMARIES[card.provider]}
            </p>

            {available && <CardBody card={card} signingIn={signingIn} />}
        </section>
    );
}

function CardBody({
    card,
    signingIn,
}: {
    card: ProviderConnectionCard;
    signingIn: boolean;
}) {
    if (signingIn && card.login !== null) {
        return <ChatGptSignInSteps signIn={card.login} />;
    }

    if (card.status === 'connected') {
        return <ConnectedTools card={card} />;
    }

    return (
        <div className="space-y-4">
            {card.status === 'unreadable' && (
                <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>
                        The saved {card.auth === 'oauth' ? 'sign-in' : 'key'}{' '}
                        can no longer be read
                    </AlertTitle>
                    <AlertDescription>
                        The server&apos;s credential key has changed.{' '}
                        {card.auth === 'oauth'
                            ? 'Sign in again'
                            : 'Paste your key again'}{' '}
                        to replace it.
                    </AlertDescription>
                </Alert>
            )}
            {card.auth === 'oauth' ? (
                <ChatGptStart ended={card.login} />
            ) : (
                <ApiKeyForm card={card} />
            )}
        </div>
    );
}

function StatusBadge({
    card,
    signingIn,
}: {
    card: ProviderConnectionCard;
    signingIn: boolean;
}) {
    if (card.status === null) {
        return <Badge variant="outline">Unavailable</Badge>;
    }

    if (signingIn) {
        return <Badge variant="secondary">Signing in</Badge>;
    }

    switch (card.status) {
        case 'connected':
            return <Badge>Connected</Badge>;
        case 'unreadable':
            return <Badge variant="destructive">Connect again</Badge>;
        default:
            return <Badge variant="outline">Not connected</Badge>;
    }
}
