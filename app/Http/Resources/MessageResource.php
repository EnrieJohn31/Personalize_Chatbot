<?php

namespace App\Http\Resources;

use App\Models\Message;
use App\Services\Chat\RunRequestFactory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Message */
class MessageResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'conversation_id' => $this->conversation_id,
            'sequence' => $this->sequence,
            'role' => $this->role,
            'content' => $this->content,
            'model' => $this->writtenBy(),
            'created_at' => $this->created_at,
        ];
    }

    /** The model that wrote an assistant reply; null for user messages and built-in replies. */
    private function writtenBy(): ?string
    {
        // Cast to an array by the model; read as mixed because older rows may lack these fields.
        $canonical = $this->resource->getAttribute('canonical_content');
        $provider = is_array($canonical) ? ($canonical['provider'] ?? null) : null;
        $model = is_array($canonical) ? ($canonical['model'] ?? null) : null;

        return $this->role === 'assistant' && is_string($model) && $model !== '' && $provider !== RunRequestFactory::SIMULATED_PROVIDER
            ? $model
            : null;
    }
}
