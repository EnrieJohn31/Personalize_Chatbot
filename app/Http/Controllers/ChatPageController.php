<?php

namespace App\Http\Controllers;

use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Chat\ActiveRuns;
use App\Services\Chat\ConversationRepository;
use App\Services\Chat\RunRequestFactory;
use Illuminate\Container\Attributes\Config;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Initial data for the chat page. Later reads and writes use the /api/chat endpoints, so the
 * props reuse their resources and the next-page link points at the JSON conversation list.
 * `active_run` lets a reloaded or newly opened page resume a reply that is still streaming, and
 * `assistant` says which account and model answer this conversation (or a new one).
 */
class ChatPageController extends Controller
{
    /**
     * @param  array<string, array{name: string, auth: string, test_model: string}>  $providers
     */
    public function __construct(
        private readonly ConversationRepository $repository,
        private readonly ActiveRuns $runs,
        #[Config('assistant.connection_providers')] private readonly array $providers,
        #[Config('assistant.live_replies')] private readonly bool $liveReplies = false,
    ) {}

    public function index(Request $request): Response
    {
        return $this->render($request, null);
    }

    public function show(Request $request, Conversation $conversation): Response
    {
        return $this->render($request, $conversation);
    }

    private function render(Request $request, ?Conversation $conversation): Response
    {
        /** @var User $user */
        $user = $request->user();
        $conversations = $this->repository->recentConversations($user)
            ->withPath(route('chat.conversations.index', absolute: false));
        $history = $conversation === null ? null : $this->repository->historyPage($conversation);

        return Inertia::render('chat/index', [
            'conversations' => [
                'data' => ConversationResource::collection($conversations->items())->resolve($request),
                'next_page_url' => $conversations->nextPageUrl(),
            ],
            'conversation' => $conversation === null ? null : (new ConversationResource($conversation))->resolve($request),
            'messages' => $history === null ? null : [
                'data' => MessageResource::collection($history['messages'])->resolve($request),
                'next_before_sequence' => $history['next_before_sequence'],
                'per_page' => $history['per_page'],
            ],
            'active_run' => $this->runs->activeRun($user),
            'assistant' => $this->assistant($user, $conversation),
        ]);
    }

    /**
     * Who answers: the conversation's recorded choice, or for a new chat the user's current one.
     * `ready` uses the mirrored connection status; no engine call is made.
     *
     * @return array{provider: string|null, name: string, model: string|null, ready: bool, live: bool}
     */
    private function assistant(User $user, ?Conversation $conversation): array
    {
        [$provider, $model, $connection] = $conversation === null
            ? [$user->chatConnection?->provider, $user->chat_model, $user->chatConnection]
            : [$conversation->model_provider, $conversation->model, $conversation->providerConnection];

        if ($provider === null || $model === null || $provider === RunRequestFactory::SIMULATED_PROVIDER) {
            return ['provider' => null, 'name' => __('Built-in assistant'), 'model' => null, 'ready' => true, 'live' => $this->liveReplies];
        }

        return [
            'provider' => $provider,
            'name' => $this->providers[$provider]['name'] ?? $provider,
            'model' => $model,
            'ready' => $connection instanceof ProviderConnection && $connection->status === RunRequestFactory::READY_CONNECTION_STATUS,
            'live' => $this->liveReplies,
        ];
    }
}
