<?php

namespace App\Http\Resources;

use App\Models\Conversation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Conversation */
class ConversationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'provider_connection_id' => $this->provider_connection_id,
            // What this conversation was started with; null uses the built-in assistant.
            'model_provider' => $this->model_provider,
            'model' => $this->model,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
