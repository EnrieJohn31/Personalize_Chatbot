import { Info, TriangleAlert } from 'lucide-react';
import { ApiKeyForm } from '@/components/connections/api-key-form';
import {
    ChatGptSignInSteps,
    ChatGptStart,
} from '@/components/connections/chatgpt-sign-in';
import { ConnectedTools } from '@/components/connections/connected-tools';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
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
    local: 'A model server on this computer or your local network, such as Ollama, LM Studio, llama.cpp or vLLM. The administrator sets it up for everyone; replies stay on your network and cost nothing per message.',
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

    if (card.auth === 'none' && card.status !== 'connected') {
        return <LocalServerProblem card={card} />;
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
            {card.status === 'reauth_required' && (
                <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>
                        {card.auth === 'oauth'
                            ? `${card.name} no longer accepts this sign-in`
                            : 'The key was rejected'}
                    </AlertTitle>
                    <AlertDescription>
                        {card.rejection !== null ? (
                            <>
                                <p>{card.rejection.message}</p>
                                <p className="text-xs">
                                    Refused on{' '}
                                    {formatDateTime(card.rejection.at)}.
                                </p>
                            </>
                        ) : card.auth === 'oauth' ? (
                            `${card.name} no longer accepts this sign-in. Sign in again to keep using it.`
                        ) : (
                            `${card.name} no longer accepts this key. Paste a new one to keep using it.`
                        )}
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

/** The local server is either not set up yet or did not answer; both are fixed by the administrator. */
function LocalServerProblem({ card }: { card: ProviderConnectionCard }) {
    if (card.local === null || !card.local.configured) {
        return (
            <Alert>
                <Info />
                <AlertTitle>No local model server is set up</AlertTitle>
                <AlertDescription>
                    <p>
                        An administrator adds the server&apos;s address to the
                        server&apos;s <code>.env</code> file and restarts the
                        engine, for example:
                    </p>
                    <code className="block rounded bg-muted px-2 py-1 text-xs break-all">
                        LOCAL_LLM_URL=http://host.docker.internal:11434/v1
                    </code>
                    <p>
                        Use <code>host.docker.internal</code> for a server on
                        this computer, or its network address, such as{' '}
                        <code>http://192.168.1.20:1234/v1</code>.
                    </p>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{card.name} is not answering</AlertTitle>
            <AlertDescription>
                <p>
                    {card.local.error ?? 'The server could not be reached.'}{' '}
                    Check that it is running at{' '}
                    <code className="break-all">{card.local.base_url}</code>.
                </p>
                <p>
                    LM Studio needs its local server started. On Linux, or on
                    another computer, the server must also listen on all
                    addresses, for Ollama <code>OLLAMA_HOST=0.0.0.0</code>.
                </p>
            </AlertDescription>
        </Alert>
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

    if (card.auth === 'none' && card.status === 'not_connected') {
        return <Badge variant="outline">Not set up</Badge>;
    }

    switch (card.status) {
        case 'connected':
            return (
                <Badge>
                    {card.auth === 'none' ? 'Available' : 'Connected'}
                </Badge>
            );
        case 'unreadable':
            return <Badge variant="destructive">Connect again</Badge>;
        case 'reauth_required':
            return (
                <Badge variant="destructive">
                    {card.auth === 'oauth' ? 'Sign in again' : 'Key rejected'}
                </Badge>
            );
        case 'unreachable':
            return <Badge variant="destructive">Not answering</Badge>;
        default:
            return <Badge variant="outline">Not connected</Badge>;
    }
}
