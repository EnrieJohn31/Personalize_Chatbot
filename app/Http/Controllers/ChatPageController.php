<?php

namespace App\Http\Controllers;

use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Chat\ActiveRuns;
use App\Services\Chat\ConversationRepository;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Initial data for the chat page. Later reads and writes use the /api/chat endpoints, so the
 * props reuse their resources and the next-page link points at the JSON conversation list.
 * `active_run` lets a reloaded or newly opened page resume a reply that is still streaming.
 */
class ChatPageController extends Controller
{
    public function __construct(
        private readonly ConversationRepository $repository,
        private readonly ActiveRuns $runs,
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
        ]);
    }
}
