import { useState } from 'react';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { MAX_TITLE_LENGTH, characterCount } from '@/lib/chat-composer';
import type { Conversation } from '@/types';

type Props = {
    conversation: Conversation | null;
    onClose: () => void;
    /** Resolves to an error message, or null once saved. */
    onSave: (
        conversation: Conversation,
        title: string,
    ) => Promise<string | null>;
};

export function RenameConversationDialog({
    conversation,
    onClose,
    onSave,
}: Props) {
    return (
        <Dialog
            open={conversation !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="sm:max-w-md">
                {conversation && (
                    // Keyed so each opening starts from the current title.
                    <RenameForm
                        key={conversation.id}
                        conversation={conversation}
                        onSave={onSave}
                        onDone={onClose}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function RenameForm({
    conversation,
    onSave,
    onDone,
}: {
    conversation: Conversation;
    onSave: Props['onSave'];
    onDone: () => void;
}) {
    const [title, setTitle] = useState(conversation.title);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const trimmed = title.trim();
    const valid = trimmed !== '' && characterCount(trimmed) <= MAX_TITLE_LENGTH;

    const save = async (): Promise<void> => {
        if (!valid || saving) {
            return;
        }

        setSaving(true);
        const failure = await onSave(conversation, trimmed);
        setSaving(false);

        if (failure === null) {
            onDone();
        } else {
            setError(failure);
        }
    };

    return (
        <form
            className="grid gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <DialogHeader>
                <DialogTitle>Rename conversation</DialogTitle>
                <DialogDescription>
                    Titles are visible only to you.
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
                <Label htmlFor="conversation-title">Title</Label>
                <Input
                    id="conversation-title"
                    value={title}
                    maxLength={MAX_TITLE_LENGTH}
                    autoFocus
                    aria-invalid={error !== null || undefined}
                    onChange={(event) => {
                        setTitle(event.target.value);
                        setError(null);
                    }}
                />
                <InputError message={error ?? undefined} />
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        Cancel
                    </Button>
                </DialogClose>
                <Button type="submit" disabled={!valid || saving}>
                    {saving && <Spinner />}
                    Save
                </Button>
            </DialogFooter>
        </form>
    );
}
