<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['title', 'provider_connection_id'])]
class Conversation extends Model
{
    use HasUuids;

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<ProviderConnection, $this> */
    public function providerConnection(): BelongsTo
    {
        return $this->belongsTo(ProviderConnection::class);
    }

    /** @return HasMany<Message, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }
}
