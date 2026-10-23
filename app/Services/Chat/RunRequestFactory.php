<?php

namespace App\Services\Chat;

use App\Data\Agent\RunRequest;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Container\Attributes\Config;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Builds the immutable run snapshot from owned history. Ownership is resolved here from the
 * acting user before anything is dispatched; browser input never selects the owner, model,
 * connection or capabilities.
 */
final class RunRequestFactory
{
    /** Needs no provider connection; the engine admits it only when simulation is enabled. */
    public const SIMULATED_PROVIDER = 'simulated';

    /** The only connection status that may back a live model. Task 3.1 defines how a connection reaches it. */
    public const READY_CONNECTION_STATUS = 'connected';

    /**
     * @param  array{id: string, version: int, model: array{provider: string, id: string}, capabilities: list<string>}  $profile
     * @param  array{history_messages: int, max_model_rounds: int, max_tool_calls: int, run_deadline_ms: int}  $limits
     */
    public function __construct(
        #[Config('assistant.profile')] private readonly array $profile,
        #[Config('assistant.limits')] private readonly array $limits,
    ) {}

    /**
     * @throws AuthorizationException when the user does not own the conversation or its connection
     * @throws RunNotDispatchable when the conversation cannot start a run yet
     */
    public function forConversation(User $user, Conversation $conversation): RunRequest
    {
        $gate = Gate::forUser($user);
        $gate->authorize('update', $conversation);

        // Checked even when the selected model does not use the connection.
        $connection = $conversation->providerConnection;
        if ($connection !== null) {
            $gate->authorize('view', $connection);
        }

        $model = $this->profile['model'];
        $connectionId = null;
        if ($model['provider'] !== self::SIMULATED_PROVIDER) {
            if ($connection === null || $connection->provider !== $model['provider']) {
                throw RunNotDispatchable::connectionRequired($model['provider']);
            }
            if ($connection->status !== self::READY_CONNECTION_STATUS) {
                throw RunNotDispatchable::connectionNotReady($connection->status);
            }
            $connectionId = $connection->id;
        }

        $messages = $conversation->messages()
            ->orderByDesc('sequence')
            ->limit($this->limits['history_messages'])
            ->get(['id', 'role', 'content'])
            ->reverse()
            ->values();

        if ($messages->last()?->role !== 'user') {
            throw RunNotDispatchable::noPendingUserMessage();
        }

        return new RunRequest(
            runId: Str::uuid7()->toString(),
            conversationId: $conversation->id,
            userId: (string) $user->id,
            profileId: $this->profile['id'],
            profileVersion: $this->profile['version'],
            modelProvider: $model['provider'],
            modelId: $model['id'],
            connectionId: $connectionId,
            capabilities: $this->profile['capabilities'],
            messages: array_values($messages->map(fn (Message $message): array => [
                'id' => $message->id,
                'role' => $message->role,
                'content' => $message->content,
            ])->all()),
            limits: [
                'maxModelRounds' => $this->limits['max_model_rounds'],
                'maxToolCalls' => $this->limits['max_tool_calls'],
                'runDeadlineMs' => $this->limits['run_deadline_ms'],
            ],
        );
    }
}
