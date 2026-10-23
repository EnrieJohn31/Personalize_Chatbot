import { Form } from '@inertiajs/react';
import { ExternalLink } from 'lucide-react';
import ConnectionsController from '@/actions/App/Http/Controllers/ConnectionsController';
import { useFormActivity } from '@/components/connections/form-activity';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import type { ProviderConnectionCard } from '@/types';

/** Where OpenCode users create the key both OpenCode Go and Zen accept. */
const KEY_PAGE = 'https://opencode.ai/auth';

export function ApiKeyForm({
    card,
    replacing = false,
}: {
    card: ProviderConnectionCard;
    replacing?: boolean;
}) {
    const activity = useFormActivity();
    const id = `${card.provider}-api-key`;

    return (
        <Form
            {...ConnectionsController.saveKey.form({ provider: card.provider })}
            {...activity}
            options={{ preserveScroll: true }}
            resetOnSuccess
            className="space-y-2"
        >
            {({ processing, errors }) => (
                <>
                    <Label htmlFor={id}>
                        {replacing ? 'New API key' : 'API key'}
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                            id={id}
                            name="api_key"
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={errors.api_key !== undefined}
                            aria-describedby={`${id}-help ${id}-error`}
                            required
                        />
                        <Button type="submit" disabled={processing}>
                            {processing && <Spinner />}
                            {replacing ? 'Replace key' : 'Save key'}
                        </Button>
                    </div>
                    <p
                        id={`${id}-help`}
                        className="text-xs text-muted-foreground"
                    >
                        Create a key at{' '}
                        <a
                            href={KEY_PAGE}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 underline underline-offset-2"
                        >
                            opencode.ai/auth
                            <ExternalLink className="size-3" />
                            <span className="sr-only">
                                (opens in a new tab)
                            </span>
                        </a>
                        . It is stored encrypted on this server and never shown
                        again.
                    </p>
                    <InputError
                        id={`${id}-error`}
                        message={errors.api_key ?? errors.connection}
                    />
                </>
            )}
        </Form>
    );
}
