<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['sequence', 'role', 'content', 'canonical_content'])]
#[Hidden(['canonical_content'])]
class Message extends Model
{
    use HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'canonical_content' => 'array',
        ];
    }

    /** @return BelongsTo<Conversation, $this> */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }
}
