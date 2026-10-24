<?php

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Container\Attributes\Config;
use Illuminate\Support\Facades\Cache;

/**
 * Stage A run bookkeeping in the cache (Build Plan task 2.4): which user and conversation own
 * a run, and at most one in-progress run per user (Blueprint section 12). Entries expire with
 * the run deadline. The chat_runs table and fenced claims replace this in tasks 4.1–4.2.
 */
final class ActiveRuns
{
    /** Time after the run deadline during which a reader can still collect the result. */
    private const RETENTION_MARGIN_SECONDS = 60;

    public function __construct(
        #[Config('assistant.limits.run_deadline_ms')] private readonly int $runDeadlineMs,
    ) {}

    /** Takes the user's single active-run slot; false while another run holds it. */
    public function reserve(User $user, string $runId): bool
    {
        return Cache::add($this->userKey($user), $runId, $this->ttl());
    }

    /** Frees the slot after a failed admission or a finished run, if this run still holds it. */
    public function release(User $user, string $runId): void
    {
        if (Cache::get($this->userKey($user)) === $runId) {
            Cache::forget($this->userKey($user));
        }
    }

    /** Records an admitted run, with the provider and model that will write its reply. */
    public function record(string $runId, User $user, Conversation $conversation, string $provider = '', string $model = ''): void
    {
        Cache::put($this->runKey($runId), [
            'user_id' => $user->id,
            'conversation_id' => $conversation->id,
            'finished' => false,
            'provider' => $provider,
            'model' => $model,
        ], $this->ttl());
    }

    /** @return array{user_id: int, conversation_id: string, finished: bool, provider: string, model: string}|null */
    public function find(string $runId): ?array
    {
        $record = Cache::get($this->runKey($runId));

        if (! is_array($record)
            || ! is_int($record['user_id'] ?? null)
            || ! is_string($record['conversation_id'] ?? null)
            || ! is_bool($record['finished'] ?? null)) {
            return null;
        }

        return [
            'user_id' => $record['user_id'],
            'conversation_id' => $record['conversation_id'],
            'finished' => $record['finished'],
            // Records written before the provider was kept have none.
            'provider' => is_string($record['provider'] ?? null) ? $record['provider'] : '',
            'model' => is_string($record['model'] ?? null) ? $record['model'] : '',
        ];
    }

    public function finish(string $runId, User $user): void
    {
        $record = $this->find($runId);

        if ($record !== null) {
            Cache::put($this->runKey($runId), [...$record, 'finished' => true], $this->ttl());
        }

        $this->release($user, $runId);
    }

    /**
     * The user's unfinished run, if any, as returned to the browser.
     *
     * @return array{id: string, conversation_id: string, events_url: string}|null
     */
    public function activeRun(User $user): ?array
    {
        $runId = Cache::get($this->userKey($user));
        $record = is_string($runId) ? $this->find($runId) : null;

        return $record === null || $record['finished'] ? null : $this->describe($runId, $record['conversation_id']);
    }

    /** @return array{id: string, conversation_id: string, events_url: string} */
    public function describe(string $runId, string $conversationId): array
    {
        return [
            'id' => $runId,
            'conversation_id' => $conversationId,
            'events_url' => route('chat.runs.events', ['run' => $runId], absolute: false),
        ];
    }

    private function ttl(): int
    {
        return (int) ceil($this->runDeadlineMs / 1000) + self::RETENTION_MARGIN_SECONDS;
    }

    private function userKey(User $user): string
    {
        return "chat:active-run:user:$user->id";
    }

    private function runKey(string $runId): string
    {
        return "chat:run:$runId";
    }
}
