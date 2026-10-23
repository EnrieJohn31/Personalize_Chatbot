<?php

namespace App\Http\Resources;

use App\Models\ProviderConnection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ProviderConnection */
class ProviderConnectionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'provider' => $this->provider,
            'auth_method' => $this->auth_method,
            'status' => $this->status,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
