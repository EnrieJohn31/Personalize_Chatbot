<?php

namespace App\Services\Chat;

use App\Contracts\AgentGateway;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;

/**
 * Permanently deletes a user's conversations; their messages go with them through the foreign
 * key. A reply still being written for a deleted conversation is stopped first, so it neither
 * tries to save into a missing conversation nor keeps the user's single reply slot.
 */
final class ConversationDeletion
{
    public function __construct(
        private readonly ActiveRuns $runs,
        private readonly AgentGateway $gateway,
    ) {}

    /**
     * Deletes the given conversations that the user owns; other IDs are ignored.
     *
     * @param  list<string>  $ids
     * @return list<string> the IDs that were deleted
     */
    public function delete(User $user, array $ids): array
    {
        /** @var list<string> $owned */
        $owned = $user->conversations()->whereKey($ids)->pluck('id')->all();
        if ($owned === []) {
            return [];
        }

        $this->stopReplyIn($user, $owned);
        $user->conversations()->whereKey($owned)->delete();

        return $owned;
    }

    /** @param  list<string>  $ids */
    private function stopReplyIn(User $user, array $ids): void
    {
        $run = $this->runs->activeRun($user);
        if ($run === null || ! in_array($run['conversation_id'], $ids, true)) {
            return;
        }

        try {
            $this->gateway->cancel($run['id']);
        } catch (AgentGatewayException) {
            // Best effort: the engine also ends the run at its deadline, and nothing will save it.
        }

        $this->runs->finish($run['id'], $user);
    }
}
