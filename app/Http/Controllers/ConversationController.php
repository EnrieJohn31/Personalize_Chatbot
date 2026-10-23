<?php

namespace App\Http\Controllers;

use App\Http\Requests\Chat\PaginatedRequest;
use App\Http\Requests\Chat\SaveConversationRequest;
use App\Http\Requests\Chat\ShowConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ConversationController extends Controller
{
    public function index(PaginatedRequest $request): AnonymousResourceCollection
    {
        return ConversationResource::collection(
            $request->user()->conversations()
                ->orderByDesc('updated_at')->orderByDesc('id')
                ->simplePaginate($request->integer('per_page', 25))
                ->appends($request->safe()->only(['per_page'])),
        );
    }

    public function store(SaveConversationRequest $request): ConversationResource
    {
        return new ConversationResource($request->user()->conversations()->create($request->validated()));
    }

    public function show(ShowConversationRequest $request, Conversation $conversation): ConversationResource
    {
        $perPage = $request->integer('per_page', 50);
        $query = $conversation->messages()->orderByDesc('sequence');

        if ($request->has('before_sequence')) {
            $query->where('sequence', '<', $request->integer('before_sequence'));
        }

        $messages = $query->limit($perPage + 1)->get();
        $hasMore = $messages->count() > $perPage;
        $page = $messages->take($perPage)->reverse()->values();

        return (new ConversationResource($conversation))->additional([
            'messages' => [
                'data' => MessageResource::collection($page),
                'next_before_sequence' => $hasMore ? $page->first()?->sequence : null,
                'per_page' => $perPage,
            ],
        ]);
    }

    public function update(SaveConversationRequest $request, Conversation $conversation): ConversationResource
    {
        $conversation->update($request->validated());

        return new ConversationResource($conversation);
    }
}
