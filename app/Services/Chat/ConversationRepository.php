<?php

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\Message;
use Illuminate\Support\Facades\DB;

class ConversationRepository
{
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
}
