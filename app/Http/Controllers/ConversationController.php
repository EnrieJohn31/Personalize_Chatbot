<?php

namespace App\Http\Controllers;

use App\Http\Requests\Chat\PaginatedRequest;
use App\Http\Requests\Chat\SaveConversationRequest;
use App\Http\Requests\Chat\ShowConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Services\Chat\ConversationRepository;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ConversationController extends Controller
{
    public function __construct(private readonly ConversationRepository $repository) {}

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
}
