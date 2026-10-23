import { Form, Head, usePoll } from '@inertiajs/react';
import { CircleCheck, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConnectionsController from '@/actions/App/Http/Controllers/Settings/ConnectionsController';
import Heading from '@/components/heading';
import InputError from '@/components/input-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { edit as editConnections } from '@/routes/connections';
import type { ChatGptConnection, ChatGptSignIn, ConnectionTest } from '@/types';

type Props = {
    chatgpt: ChatGptConnection;
    defaultTestModel: string;
};

const ACTIVE_STATES: ChatGptSignIn['state'][] = [
    'starting',
    'waiting_for_user',
    'exchanging',
];

export default function Connections({ chatgpt, defaultTestModel }: Props) {
    const signIn = chatgpt.login;
    const signingIn = signIn !== null && ACTIVE_STATES.includes(signIn.state);
    const [submitting, setSubmitting] = useState(false);

    // While a sign-in runs, reload only this prop so the page notices the browser finishing it.
    // Polling pauses while a sign-in form submits, so no reload races the form's own answer.
    const { start, stop } = usePoll(
        2000,
        { only: ['chatgpt'] },
        { autoStart: false, mode: 'rest' },
    );
    useEffect(() => {
        if (!signingIn || submitting) {
            return;
        }

        start();

        return stop;
    }, [signingIn, submitting, start, stop]);

    return (
        <>
            <Head title="Connections" />

            <h1 className="sr-only">Connections</h1>

            <div className="space-y-6">
                <Heading
                    variant="small"
                    title="Connections"
                    description="Use your own AI subscription with this assistant"
                />

                <section
                    aria-labelledby="chatgpt-heading"
                    className="space-y-5 rounded-lg border p-4 sm:p-5"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 id="chatgpt-heading" className="font-medium">
                            ChatGPT
                        </h2>
                        <StatusBadge chatgpt={chatgpt} signingIn={signingIn} />
                    </div>

                    <p className="text-sm text-muted-foreground">
                        Sign in with your ChatGPT account, for example a Plus or
                        Pro plan. OpenAI decides during sign-in whether your
                        plan can be used here, and replies count toward your
                        plan&apos;s usage. Your sign-in stays encrypted on this
                        server and is never sent to your browser.
                    </p>

                    {chatgpt.engine !== 'available' ? (
                        <EngineProblem engine={chatgpt.engine} />
                    ) : signingIn ? (
                        <SignInSteps
                            signIn={signIn}
                            onSubmitting={setSubmitting}
                        />
                    ) : chatgpt.status === 'connected' ? (
                        <Connected
                            chatgpt={chatgpt}
                            defaultTestModel={defaultTestModel}
                        />
                    ) : (
                        <NotConnected chatgpt={chatgpt} />
                    )}
                </section>
            </div>
        </>
    );
}

function StatusBadge({
    chatgpt,
    signingIn,
}: {
    chatgpt: ChatGptConnection;
    signingIn: boolean;
}) {
    if (chatgpt.engine !== 'available') {
        return <Badge variant="outline">Unavailable</Badge>;
    }

    if (signingIn) {
        return <Badge variant="secondary">Signing in</Badge>;
    }

    switch (chatgpt.status) {
        case 'connected':
            return <Badge>Connected</Badge>;
        case 'unreadable':
            return <Badge variant="destructive">Sign in again</Badge>;
        default:
            return <Badge variant="outline">Not connected</Badge>;
    }
}

function EngineProblem({
    engine,
}: {
    engine: Exclude<ChatGptConnection['engine'], 'available'>;
}) {
    return (
        <Alert>
            <TriangleAlert />
            <AlertTitle>
                {engine === 'not_configured'
                    ? 'ChatGPT sign-in is not set up on this server'
                    : 'The assistant engine is not reachable'}
            </AlertTitle>
            <AlertDescription>
                {engine === 'not_configured'
                    ? 'An administrator needs to set AGENT_CREDENTIAL_KEY and restart the engine.'
                    : 'Try again in a moment. If this keeps happening, check that the engine container is running.'}
            </AlertDescription>
        </Alert>
    );
}

function NotConnected({ chatgpt }: { chatgpt: ChatGptConnection }) {
    const ended = chatgpt.login;

    return (
        <div className="space-y-4">
            {chatgpt.status === 'unreadable' && (
                <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>
                        Your saved sign-in can no longer be read
                    </AlertTitle>
                    <AlertDescription>
                        The server&apos;s credential key has changed. Sign in
                        again to replace it.
                    </AlertDescription>
                </Alert>
            )}

            {ended !== null && ended.error !== null && (
                <Alert
                    variant={
                        ended.state === 'failed' ? 'destructive' : 'default'
                    }
                >
                    {ended.state === 'failed' ? <TriangleAlert /> : <Info />}
                    <AlertTitle>
                        {ended.state === 'failed'
                            ? 'Sign-in did not finish'
                            : 'Sign-in cancelled'}
                    </AlertTitle>
                    <AlertDescription>{ended.error}</AlertDescription>
                </Alert>
            )}

            <Form
                {...ConnectionsController.startLogin.form()}
                options={{ preserveScroll: true }}
                className="space-y-2"
            >
                {({ processing, errors }) => (
                    <>
                        <Button type="submit" disabled={processing}>
                            {processing && <Spinner />}
                            Sign in with ChatGPT
                        </Button>
                        <InputError message={errors.connection} />
                    </>
                )}
            </Form>
        </div>
    );
}

function SignInSteps({
    signIn,
    onSubmitting,
}: {
    signIn: ChatGptSignIn;
    onSubmitting: (submitting: boolean) => void;
}) {
    const submitCallbacks = {
        onStart: () => onSubmitting(true),
        onFinish: () => onSubmitting(false),
    };

    if (signIn.state !== 'waiting_for_user' || signIn.auth_url === null) {
        return (
            <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
            >
                <Spinner />
                {signIn.state === 'exchanging'
                    ? 'Finishing sign-in…'
                    : 'Preparing the sign-in page…'}
            </p>
        );
    }

    return (
        <div className="space-y-5">
            <ol className="list-decimal space-y-4 pl-5 text-sm">
                <li className="space-y-2 pl-1">
                    <p>Open the ChatGPT sign-in page in a new tab.</p>
                    <Button asChild size="sm">
                        <a
                            href={signIn.auth_url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Open sign-in page
                            <ExternalLink />
                            <span className="sr-only">
                                (opens in a new tab)
                            </span>
                        </a>
                    </Button>
                </li>
                <li className="pl-1">
                    Sign in and approve access. This page updates by itself when
                    you are done.
                </li>
                <li className="space-y-3 pl-1">
                    <p>
                        If that tab instead shows an error page at{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                            127.0.0.1:1455
                        </code>
                        , copy the full address from its address bar and paste
                        it here.
                    </p>
                    <PasteRedirect {...submitCallbacks} />
                </li>
            </ol>

            <div className="flex flex-wrap items-center gap-3">
                <Form
                    {...ConnectionsController.cancelLogin.form()}
                    {...submitCallbacks}
                    options={{ preserveScroll: true }}
                >
                    {({ processing, errors }) => (
                        <>
                            <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                disabled={processing}
                            >
                                Cancel sign-in
                            </Button>
                            <InputError message={errors.connection} />
                        </>
                    )}
                </Form>
                <p className="text-xs text-muted-foreground">
                    Expires at {formatTime(signIn.expires_at)}
                </p>
            </div>
        </div>
    );
}

function PasteRedirect({
    onStart,
    onFinish,
}: {
    onStart: () => void;
    onFinish: () => void;
}) {
    return (
        <Form
            {...ConnectionsController.completeLogin.form()}
            onStart={onStart}
            onFinish={onFinish}
            options={{ preserveScroll: true }}
            resetOnSuccess
            className="space-y-2"
        >
            {({ processing, errors }) => (
                <>
                    <Label htmlFor="redirect_url" className="sr-only">
                        Address from the finished sign-in tab
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                            id="redirect_url"
                            name="redirect_url"
                            type="url"
                            inputMode="url"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="http://127.0.0.1:1455/auth/callback?code=…"
                            aria-invalid={errors.redirect_url !== undefined}
                            aria-describedby="redirect_url-error"
                            required
                        />
                        <Button
                            type="submit"
                            variant="outline"
                            disabled={processing}
                        >
                            {processing && <Spinner />}
                            Finish sign-in
                        </Button>
                    </div>
                    <InputError
                        id="redirect_url-error"
                        message={errors.redirect_url ?? errors.connection}
                    />
                </>
            )}
        </Form>
    );
}

function Connected({
    chatgpt,
    defaultTestModel,
}: {
    chatgpt: ChatGptConnection;
    defaultTestModel: string;
}) {
    const [result, setResult] = useState<ConnectionTest | null>(null);
    const initialModel = chatgpt.models.includes(defaultTestModel)
        ? defaultTestModel
        : (chatgpt.models[0] ?? '');

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />
                <p>
                    Your ChatGPT account is connected. Access renews
                    automatically
                    {chatgpt.expires_at !== null &&
                        `; the current token is valid until ${formatTime(chatgpt.expires_at)}`}
                    .
                </p>
            </div>

            <Alert>
                <Info />
                <AlertDescription>
                    Chat replies still come from the built-in simulation.
                    Switching chat to your ChatGPT connection is the next
                    update.
                </AlertDescription>
            </Alert>

            <Form
                {...ConnectionsController.test.form()}
                options={{ preserveScroll: true }}
                onStart={() => setResult(null)}
                onFlash={(flash) => setResult(connectionTest(flash))}
                className="space-y-3"
            >
                {({ processing, errors }) => (
                    <>
                        <div className="grid gap-2">
                            <Label htmlFor="model_id">Test model</Label>
                            <Select name="model_id" defaultValue={initialModel}>
                                <SelectTrigger
                                    id="model_id"
                                    className="w-full sm:w-72"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {chatgpt.models.map((model) => (
                                        <SelectItem key={model} value={model}>
                                            {model}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <InputError message={errors.model_id} />
                        </div>
                        <div className="space-y-1">
                            <Button
                                type="submit"
                                variant="outline"
                                disabled={processing || initialModel === ''}
                            >
                                {processing && <Spinner />}
                                Send test message
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                Sends one short message, which counts toward
                                your plan&apos;s usage.
                            </p>
                        </div>
                        <InputError message={errors.connection} />
                        <div aria-live="polite">
                            {result !== null && <TestResult result={result} />}
                        </div>
                    </>
                )}
            </Form>

            <Disconnect />
        </div>
    );
}

function TestResult({ result }: { result: ConnectionTest }) {
    if (result.ok) {
        const seconds = (result.latency_ms / 1000).toFixed(1);

        return (
            <Alert>
                <CircleCheck />
                <AlertTitle>The connection works</AlertTitle>
                <AlertDescription>
                    {result.model_id} replied in {seconds} s
                    {result.reply !== null && `: “${result.reply}”`}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>The test message failed</AlertTitle>
            <AlertDescription>
                {result.error ?? 'The provider returned an error.'}
            </AlertDescription>
        </Alert>
    );
}

function Disconnect() {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                    Disconnect ChatGPT
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogTitle>Disconnect ChatGPT?</DialogTitle>
                <DialogDescription>
                    This removes your sign-in from this server. To revoke the
                    access completely, also remove it in your ChatGPT account
                    settings.
                </DialogDescription>
                <Form
                    {...ConnectionsController.disconnect.form()}
                    options={{ preserveScroll: true }}
                >
                    {({ processing, errors }) => (
                        <>
                            <InputError message={errors.connection} />
                            <DialogFooter className="gap-2">
                                <DialogClose asChild>
                                    <Button variant="secondary">Keep</Button>
                                </DialogClose>
                                <Button
                                    type="submit"
                                    variant="destructive"
                                    disabled={processing}
                                >
                                    Disconnect
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function connectionTest(flash: Record<string, unknown>): ConnectionTest | null {
    const value = flash.connectionTest;

    return typeof value === 'object' && value !== null
        ? (value as ConnectionTest)
        : null;
}

function formatTime(iso: string | null): string {
    return iso === null
        ? 'unknown'
        : new Date(iso).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
          });
}

Connections.layout = {
    breadcrumbs: [
        {
            title: 'Connections',
            href: editConnections(),
        },
    ],
};
