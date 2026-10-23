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
import { Spinner } from '@/components/ui/spinner';
import type { Conversation } from '@/types';

type Props = {
    /** The conversations to delete; the dialog is open while this is not empty. */
    conversations: Conversation[];
    onClose: () => void;
    /** Resolves to an error message, or null once deleted. */
    onConfirm: (ids: string[]) => Promise<string | null>;
};

export function DeleteConversationsDialog({
    conversations,
    onClose,
    onConfirm,
}: Props) {
    return (
        <Dialog
            open={conversations.length > 0}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="sm:max-w-md">
                {conversations.length > 0 && (
                    // Keyed so each opening starts without an earlier error.
                    <ConfirmDeletion
                        key={conversations.map(({ id }) => id).join()}
                        conversations={conversations}
                        onConfirm={onConfirm}
                        onDone={onClose}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ConfirmDeletion({
    conversations,
    onConfirm,
    onDone,
}: {
    conversations: Conversation[];
    onConfirm: Props['onConfirm'];
    onDone: () => void;
}) {
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const single = conversations.length === 1 ? conversations[0] : null;

    const confirm = async (): Promise<void> => {
        setDeleting(true);
        const failure = await onConfirm(conversations.map(({ id }) => id));
        setDeleting(false);

        if (failure === null) {
            onDone();
        } else {
            setError(failure);
        }
    };

    return (
        <div className="grid gap-4">
            <DialogHeader>
                <DialogTitle className="break-words">
                    {single
                        ? `Delete “${single.title}”?`
                        : `Delete ${conversations.length} conversations?`}
                </DialogTitle>
                <DialogDescription>
                    {single
                        ? 'The conversation and all of its messages are deleted permanently.'
                        : 'These conversations and all of their messages are deleted permanently.'}{' '}
                    A reply that is still being written is stopped. This cannot
                    be undone.
                </DialogDescription>
            </DialogHeader>
            <InputError message={error ?? undefined} />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        Cancel
                    </Button>
                </DialogClose>
                <Button
                    type="button"
                    variant="destructive"
                    disabled={deleting}
                    onClick={() => void confirm()}
                >
                    {deleting && <Spinner />}
                    Delete
                </Button>
            </DialogFooter>
        </div>
    );
}
