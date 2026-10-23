<?php

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Pagination\Paginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ConversationRepository
{
    /** @return Paginator<int, Conversation> Newest activity first, with a stable tie-breaker. */
    public function recentConversations(User $user, int $perPage = 25): Paginator
    {
        return $user->conversations()
            ->orderByDesc('updated_at')->orderByDesc('id')
            ->simplePaginate($perPage);
    }

    /**
     * One page of history ending before $beforeSequence (or at the latest message), in display order.
     *
     * @return array{messages: Collection<int, Message>, next_before_sequence: int|null, per_page: int}
     */
    public function historyPage(Conversation $conversation, int $perPage = 50, ?int $beforeSequence = null): array
    {
        $query = $conversation->messages()->orderByDesc('sequence');

        if ($beforeSequence !== null) {
            $query->where('sequence', '<', $beforeSequence);
        }

        $messages = $query->limit($perPage + 1)->get();
        $hasMore = $messages->count() > $perPage;
        $page = $messages->take($perPage)->reverse()->values();

        return [
            'messages' => $page,
            'next_before_sequence' => $hasMore ? $page->first()?->sequence : null,
            'per_page' => $perPage,
        ];
    }

    public function appendUserMessage(Conversation $conversation, string $content): Message
    {
        return DB::transaction(function () use ($conversation, $content): Message {
            // Serialize appends on the parent; the unique sequence index is the final guard.
            $locked = Conversation::query()->whereKey($conversation->id)->lockForUpdate()->firstOrFail();

            $message = $locked->messages()->create([
                'sequence' => ((int) $locked->messages()->max('sequence')) + 1,
                'role' => 'user',
                'content' => $content,
                'canonical_content' => ['role' => 'user', 'content' => $content],
            ]);

            $locked->touch();

            return $message;
        }, attempts: 3);
    }

    /**
     * The trusted server path for a run's final answer. Saving is idempotent per run, so every
     * reader that reaches the run's completion can call it and only one message is stored.
     */
    public function appendAssistantMessage(Conversation $conversation, string $content, string $runId): Message
    {
        return DB::transaction(function () use ($conversation, $content, $runId): Message {
            $locked = Conversation::query()->whereKey($conversation->id)->lockForUpdate()->firstOrFail();

            $existing = $locked->messages()
                ->where('role', 'assistant')
                ->where('canonical_content->run_id', $runId)
                ->first();
            if ($existing !== null) {
                return $existing;
            }

            $message = $locked->messages()->create([
                'sequence' => ((int) $locked->messages()->max('sequence')) + 1,
                'role' => 'assistant',
                'content' => $content,
                'canonical_content' => ['role' => 'assistant', 'content' => $content, 'run_id' => $runId],
            ]);

            $locked->touch();

            return $message;
        }, attempts: 3);
    }
}
