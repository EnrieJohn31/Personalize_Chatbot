import { Form } from '@inertiajs/react';
import { Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { useFormActivity } from '@/components/connections/form-activity';
import InputError from '@/components/input-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { ChatChoice as Choice, ProviderConnectionCard } from '@/types';

/** Select value for the built-in assistant; Radix selects cannot use an empty value. */
const BUILT_IN = 'built-in';

const defaultModel = (card: ProviderConnectionCard | undefined): string =>
    card === undefined
        ? ''
        : card.models.includes(card.test_model)
          ? card.test_model
          : (card.models[0] ?? '');

/**
 * Which connection and model chat replies use. The page remounts this when the saved choice or
 * the set of connected providers changes, so the selects always start from the saved state.
 */
export function ChatChoice({
    chat,
    connected,
    disabled,
}: {
    chat: Choice | null;
    /** Providers that are connected now; only they can be chosen. */
    connected: ProviderConnectionCard[];
    disabled: boolean;
}) {
    const activity = useFormActivity();
    const [provider, setProvider] = useState<string>(
        chat !== null &&
            connected.some((card) => card.provider === chat.provider)
            ? chat.provider
            : BUILT_IN,
    );
    const card = connected.find((candidate) => candidate.provider === provider);
    const [model, setModel] = useState(
        chat !== null && card?.models.includes(chat.model)
            ? chat.model
            : defaultModel(card),
    );

    return (
        <section
            aria-labelledby="chat-choice-heading"
            className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
        >
            <div className="space-y-1">
                <h2 id="chat-choice-heading" className="font-semibold">
                    Default for new chats
                </h2>
                <p className="text-sm leading-6 break-words text-muted-foreground">
                    {chat === null
                        ? 'Chat uses the built-in assistant.'
                        : `Chat is set to ${chat.name} with ${chat.model}.`}
                </p>
            </div>

            {chat !== null && !chat.connected && (
                <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>
                        {chat.provider === 'local'
                            ? `${chat.name} is not answering right now. Chat can use it again once it answers, or choose another option.`
                            : `${chat.name} is not connected right now. Connect it again or choose another option.`}
                    </AlertDescription>
                </Alert>
            )}

            <Form
                {...ConnectionsController.useForChat.form()}
                {...activity}
                options={{ preserveScroll: true }}
                transform={() =>
                    provider === BUILT_IN
                        ? { provider: null, model_id: null }
                        : { provider, model_id: model }
                }
                className="space-y-3"
            >
                {({ processing, errors }) => (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label htmlFor="chat-provider">
                                    Connection
                                </Label>
                                <Select
                                    value={provider}
                                    disabled={disabled}
                                    onValueChange={(value) => {
                                        setProvider(value);
                                        setModel(
                                            defaultModel(
                                                connected.find(
                                                    (candidate) =>
                                                        candidate.provider ===
                                                        value,
                                                ),
                                            ),
                                        );
                                    }}
                                >
                                    <SelectTrigger
                                        id="chat-provider"
                                        className="w-full"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={BUILT_IN}>
                                            Built-in assistant
                                        </SelectItem>
                                        {connected.map((candidate) => (
                                            <SelectItem
                                                key={candidate.provider}
                                                value={candidate.provider}
                                            >
                                                {candidate.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="chat-model">Model</Label>
                                <Select
                                    value={model}
                                    disabled={disabled || card === undefined}
                                    onValueChange={setModel}
                                >
                                    <SelectTrigger
                                        id="chat-model"
                                        className="w-full"
                                    >
                                        <SelectValue
                                            placeholder={
                                                card === undefined
                                                    ? 'Not needed'
                                                    : 'Choose a model'
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(card?.models ?? []).map((id) => (
                                            <SelectItem key={id} value={id}>
                                                {id}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <InputError message={errors.model_id} />
                            </div>
                        </div>
                        <Button
                            type="submit"
                            disabled={
                                disabled ||
                                processing ||
                                (card !== undefined && model === '')
                            }
                        >
                            {processing && <Spinner />}
                            {processing ? 'Saving…' : 'Save chat default'}
                        </Button>
                        <InputError
                            message={errors.chat ?? errors.connection}
                        />
                    </>
                )}
            </Form>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Each new chat keeps the account and model chosen here, so
                changing them later does not change earlier chats.
                {connected.length === 0 &&
                    ' Connect an account below to choose it here.'}
            </p>
        </section>
    );
}
