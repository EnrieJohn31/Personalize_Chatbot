<?php

namespace App\Http\Controllers;

use App\Http\Requests\Chat\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\Message;
use App\Services\Chat\ConversationRepository;

class MessageController extends Controller
{
    public function store(StoreMessageRequest $request, Conversation $conversation, ConversationRepository $repository): MessageResource
    {
        return new MessageResource($repository->appendUserMessage($conversation, $request->string('content')->toString()));
    }

    public function show(Conversation $conversation, Message $message): MessageResource
    {
        return new MessageResource($message);
    }
}
