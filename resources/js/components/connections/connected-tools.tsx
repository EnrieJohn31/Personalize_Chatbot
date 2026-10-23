import { Form } from '@inertiajs/react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { ApiKeyForm } from '@/components/connections/api-key-form';
import { useFormActivity } from '@/components/connections/form-activity';
import InputError from '@/components/input-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { formatTime } from '@/lib/utils';
import type { ConnectionTest, ProviderConnectionCard } from '@/types';

/** What a connected provider offers: a test message, key replacement and disconnecting. */
export function ConnectedTools({ card }: { card: ProviderConnectionCard }) {
    const [replacing, setReplacing] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-2 text-sm">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />
                <p>
                    {card.auth === 'oauth'
                        ? `Your ${card.name} account is connected. Access renews automatically${
                              card.expires_at === null
                                  ? '.'
                                  : `; the current token is valid until ${formatTime(card.expires_at)}.`
                          }`
                        : 'Your API key is saved. Requests use it until you replace or remove it.'}
                </p>
            </div>

            <TestMessage card={card} />

            {card.auth === 'api_key' &&
                (replacing ? (
                    <ApiKeyForm card={card} replacing />
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReplacing(true)}
                    >
                        Replace key
                    </Button>
                ))}

            <Disconnect card={card} />
        </div>
    );
}

function TestMessage({ card }: { card: ProviderConnectionCard }) {
    const activity = useFormActivity();
    const [result, setResult] = useState<ConnectionTest | null>(null);
    const initialModel = card.models.includes(card.test_model)
        ? card.test_model
        : (card.models[0] ?? '');
    const id = `${card.provider}-test-model`;

    return (
        <Form
            {...ConnectionsController.test.form({ provider: card.provider })}
            options={{ preserveScroll: true }}
            onStart={() => {
                activity.onStart();
                setResult(null);
            }}
            onFinish={activity.onFinish}
            onFlash={(flash) => setResult(connectionTest(flash, card))}
            className="space-y-3"
        >
            {({ processing, errors }) => (
                <>
                    <div className="grid gap-2">
                        <Label htmlFor={id}>Test model</Label>
                        <Select name="model_id" defaultValue={initialModel}>
                            <SelectTrigger id={id} className="w-full sm:w-72">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {card.models.map((model) => (
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
                            {card.auth === 'oauth'
                                ? "Sends one short message, which counts toward your plan's usage."
                                : 'Sends one short message. Free models cost nothing; others count toward your plan or balance.'}
                        </p>
                    </div>
                    <InputError message={errors.connection} />
                    <div aria-live="polite">
                        {result !== null && <TestResult result={result} />}
                    </div>
                </>
            )}
        </Form>
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

function Disconnect({ card }: { card: ProviderConnectionCard }) {
    const activity = useFormActivity();
    const action =
        card.auth === 'oauth' ? `Disconnect ${card.name}` : 'Remove key';

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                    {action}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogTitle>{action}?</DialogTitle>
                <DialogDescription>
                    {card.auth === 'oauth'
                        ? `This removes your sign-in from this server. To revoke the access completely, also remove it in your ${card.name} account settings.`
                        : `This removes your ${card.name} key from this server. The key itself stays valid until you delete it at opencode.ai.`}{' '}
                    If chat uses this connection, it returns to the built-in
                    assistant.
                </DialogDescription>
                <Form
                    {...ConnectionsController.disconnect.form({
                        provider: card.provider,
                    })}
                    {...activity}
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
                                    {card.auth === 'oauth'
                                        ? 'Disconnect'
                                        : 'Remove'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

/** This card's test result, if the flash carries one; each card only shows its own. */
function connectionTest(
    flash: Record<string, unknown>,
    card: ProviderConnectionCard,
): ConnectionTest | null {
    const value = flash.connectionTest;

    return typeof value === 'object' &&
        value !== null &&
        (value as ConnectionTest).provider === card.provider
        ? (value as ConnectionTest)
        : null;
}
