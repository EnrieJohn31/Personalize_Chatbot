import { Form } from '@inertiajs/react';
import { ExternalLink, Info, TriangleAlert } from 'lucide-react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { useFormActivity } from '@/components/connections/form-activity';
import InputError from '@/components/input-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { formatTime } from '@/lib/utils';
import type { ChatGptSignIn } from '@/types';

const provider = { provider: 'openai' } as const;

/** The start button, with the outcome of a sign-in that just ended. */
export function ChatGptStart({ ended }: { ended: ChatGptSignIn | null }) {
    const activity = useFormActivity();

    return (
        <div className="space-y-4">
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
                {...ConnectionsController.startLogin.form(provider)}
                {...activity}
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

/** The steps of a running sign-in: open OpenAI's page, approve, or paste the final address. */
export function ChatGptSignInSteps({ signIn }: { signIn: ChatGptSignIn }) {
    const activity = useFormActivity();

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
                    <PasteRedirect />
                </li>
            </ol>

            <div className="flex flex-wrap items-center gap-3">
                <Form
                    {...ConnectionsController.cancelLogin.form(provider)}
                    {...activity}
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

function PasteRedirect() {
    const activity = useFormActivity();

    return (
        <Form
            {...ConnectionsController.completeLogin.form(provider)}
            {...activity}
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
