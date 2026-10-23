<?php

namespace App\Http\Controllers;

use App\Http\Requests\Chat\DeleteConversationsRequest;
use App\Http\Requests\Chat\PaginatedRequest;
use App\Http\Requests\Chat\SaveConversationRequest;
use App\Http\Requests\Chat\ShowConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\User;
use App\Services\Chat\ConversationDeletion;
use App\Services\Chat\ConversationRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ConversationController extends Controller
{
    public function __construct(
        private readonly ConversationRepository $repository,
        private readonly ConversationDeletion $deletion,
    ) {}

    public function index(PaginatedRequest $request): AnonymousResourceCollection
    {
        return ConversationResource::collection(
            $this->repository->recentConversations($request->user(), $request->integer('per_page', 25))
                ->appends($request->safe()->only(['per_page'])),
        );
    }

    public function store(SaveConversationRequest $request): ConversationResource
    {
        return new ConversationResource($request->user()->conversations()->create($request->validated()));
    }

    public function show(ShowConversationRequest $request, Conversation $conversation): ConversationResource
    {
        $history = $this->repository->historyPage(
            $conversation,
            $request->integer('per_page', 50),
            $request->has('before_sequence') ? $request->integer('before_sequence') : null,
        );

        return (new ConversationResource($conversation))->additional([
            'messages' => [
                'data' => MessageResource::collection($history['messages']),
                'next_before_sequence' => $history['next_before_sequence'],
                'per_page' => $history['per_page'],
            ],
        ]);
    }

    public function update(SaveConversationRequest $request, Conversation $conversation): ConversationResource
    {
        $conversation->update($request->validated());

        return new ConversationResource($conversation);
    }

    /** Permanently deletes one conversation and its messages. */
    public function destroy(Request $request, Conversation $conversation): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        return response()->json(['deleted' => $this->deletion->delete($user, [$conversation->id])]);
    }

    /** Permanently deletes several of the user's conversations; IDs the user does not own are ignored. */
    public function destroyMany(DeleteConversationsRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var list<string> $ids */
        $ids = $request->validated('ids');

        return response()->json(['deleted' => $this->deletion->delete($user, $ids)]);
    }
}
