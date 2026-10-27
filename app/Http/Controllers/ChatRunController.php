<?php

namespace App\Http\Controllers;

use App\Contracts\AgentGateway;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use App\Services\Chat\ActiveRuns;
use App\Services\Chat\ConversationRepository;
use App\Services\Chat\RunNotDispatchable;
use App\Services\Chat\RunRequestFactory;
use App\Services\Connections\ProviderConnections;
use Illuminate\Container\Attributes\Config;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Stage A prototype relay (Build Plan task 2.4). Laravel admits a run with the engine and
 * relays the engine's events to the browser as server-sent events. A reply is saved by the
 * server while a reader follows the stream, even if that browser then disconnects. Runs whose
 * stream nobody opens are not saved; durable execution and replay arrive with Phase 4.
 */
class ChatRunController extends Controller
{
    public function __construct(
        private readonly AgentGateway $gateway,
        private readonly ActiveRuns $runs,
        private readonly RunRequestFactory $factory,
        private readonly ConversationRepository $repository,
        private readonly ProviderConnections $connections,
        #[Config('assistant.live_replies')] private readonly bool $liveReplies = false,
    ) {}

    public function store(Request $request, Conversation $conversation): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        // A conversation started before any choice was made answers with the current one from now on.
        if ($this->liveReplies && $this->repository->applyChatChoice($user, $conversation)) {
            $conversation->save();
        }

        try {
            $run = $this->factory->forConversation($user, $conversation);
        } catch (RunNotDispatchable $exception) {
            return $this->problem($exception->reason === 'context_too_large' ? 422 : 409, $exception->reason, match ($exception->reason) {
                'no_pending_user_message' => 'The latest message already has a reply.',
                'context_too_large' => 'This question is too large for a reply. Send a shorter question.',
                'connection_required' => "This chat's account is no longer connected. Connect it again on the Connections page.",
                'connection_not_ready' => "This chat's account needs attention. Check it on the Connections page.",
                default => 'This conversation cannot get a reply yet.',
            });
        }

        if (! $this->runs->reserve($user, $run->runId)) {
            return $this->problem(409, 'run_in_progress', 'Another reply is still being written.', [
                'run' => $this->runs->activeRun($user),
            ]);
        }

        try {
            $this->gateway->submit($run);
        } catch (AgentGatewayException $exception) {
            $this->runs->release($user, $run->runId);
            Log::warning('Run admission failed', ['run_id' => $run->runId, 'reason' => $exception->reason]);

            return match ($exception->reason) {
                'model_unavailable' => $this->problem(503, 'assistant_unavailable', 'The assistant is not available right now.'),
                'connection_required' => $this->problem(409, 'connection_required', "This chat's account is no longer connected. Connect it again on the Connections page."),
                default => $this->problem($exception->isRetryable() ? 503 : 502, 'engine_unavailable', 'The assistant could not start a reply. Try again.'),
            };
        }

        $this->runs->record($run->runId, $user, $conversation, $run->modelProvider, $run->modelId);

        return response()->json(['data' => $this->runs->describe($run->runId, $conversation->id)], 202);
    }

    /** Server-sent events for one owned run. `Last-Event-ID` resumes without repeating work. */
    public function events(Request $request, string $run): StreamedResponse|Response
    {
        /** @var User $user */
        $user = $request->user();
        $record = $this->runs->find($run);
        abort_if($record === null || $record['user_id'] !== $user->id, 404);

        // A finished run has nothing more to send; 204 also stops EventSource reconnecting.
        if ($record['finished']) {
            return response()->noContent();
        }

        $conversation = $user->conversations()->whereKey($record['conversation_id'])->firstOrFail();
        $cursor = $request->header('Last-Event-ID', (string) $request->query('after', '0'));
        $after = preg_match('/\A\d{1,7}\z/', $cursor) === 1 ? (int) $cursor : 0;

        $model = ['provider' => $record['provider'], 'model' => $record['model']];

        return response()->stream(fn () => $this->relay($user, $conversation, $run, $after, $model), 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    public function destroy(Request $request, string $run): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $record = $this->runs->find($run);
        abort_if($record === null || $record['user_id'] !== $user->id, 404);

        try {
            $this->gateway->cancel($run);
        } catch (AgentGatewayException $exception) {
            return $exception->reason === 'run_not_found'
                ? $this->problem(404, 'run_not_found', 'This reply is no longer running.')
                : $this->problem(503, 'engine_unavailable', 'The reply could not be stopped. Try again.');
        }

        return response()->json(['data' => ['id' => $run, 'status' => 'cancel_requested']], 202);
    }

    /**
     * Reads the run from its first event, so the final text is always known, and forwards only
     * events after the reader's cursor. Reading continues after the browser leaves so the reply
     * is still saved; the gateway's stream timeout bounds how long that can take.
     *
     * @param  array{provider: string, model: string}  $model  what writes the reply, saved with it
     */
    private function relay(User $user, Conversation $conversation, string $runId, int $after, array $model): void
    {
        ignore_user_abort(true);
        $final = null;

        try {
            foreach ($this->gateway->events($runId) as $event) {
                $data = $event->data;

                if ($event->type === 'assistant.final') {
                    $final = is_string($data['text']) ? $data['text'] : null;
                }

                if ($event->type === 'run.completed') {
                    $final ?? throw AgentGatewayException::invalidResponse(200, 'the run completed without a final answer.');

                    $message = $this->repository->appendAssistantMessage($conversation, $final, $runId, $model['provider'], $model['model']);
                    $data = ['message' => (new MessageResource($message))->resolve()];
                }

                if ($event->type === 'run.failed' && is_string($data['code'] ?? null)) {
                    $this->recordFailure($conversation, $data['code']);
                }

                if ($event->isTerminal()) {
                    $this->runs->finish($runId, $user);
                }

                if ($event->sequence > $after) {
                    $this->send($event->type, ['runId' => $runId, ...$data], $event->sequence);
                }
            }
        } catch (AgentGatewayException $exception) {
            Log::warning('Run relay failed', ['run_id' => $runId, 'reason' => $exception->reason]);
            $resumable = $exception->isRetryable();

            // A broken connection can be resumed with the last event ID; a contract violation
            // cannot, so that run is stopped and the user's reply slot is freed for a retry.
            if (! $resumable) {
                $this->stopQuietly($runId);
                $this->runs->finish($runId, $user);
            }

            // A relay problem, not an engine event: it has no sequence and its own event name.
            $this->send('stream.error', [
                'runId' => $runId,
                'code' => $resumable ? 'stream_interrupted' : 'relay_failed',
                'message' => $resumable ? 'The reply stream was interrupted.' : 'The reply could not be completed.',
                'resumable' => $resumable,
            ]);
        } catch (ModelNotFoundException) {
            // The conversation was deleted while its reply was being written; there is nowhere to save it.
            $this->stopQuietly($runId);
            $this->runs->finish($runId, $user);
            $this->send('stream.error', [
                'runId' => $runId,
                'code' => 'conversation_deleted',
                'message' => 'The conversation was deleted.',
                'resumable' => false,
            ]);
        }
    }

    /**
     * A reply that failed because the sign-in was rejected or is gone marks the connection, so
     * the chat header and Connections show it until the user signs in again.
     */
    private function recordFailure(Conversation $conversation, string $code): void
    {
        $connection = $conversation->providerConnection;

        if ($connection !== null && $connection->provider === $conversation->model_provider) {
            $this->connections->recordFailure($connection, $code);
        }
    }

    private function stopQuietly(string $runId): void
    {
        try {
            $this->gateway->cancel($runId);
        } catch (AgentGatewayException) {
            // Best effort: the engine also ends the run at its deadline.
        }
    }

    /** @param  array<string, mixed>  $data */
    private function send(string $type, array $data, ?int $id = null): void
    {
        if (connection_aborted()) {
            return;
        }

        echo ($id === null ? '' : "id: $id\n")."event: $type\n";
        echo 'data: '.json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n\n";

        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }

    /** @param  array<string, mixed>  $extra */
    private function problem(int $status, string $code, string $message, array $extra = []): JsonResponse
    {
        return response()->json(['code' => $code, 'message' => $message, ...$extra], $status);
    }
}
