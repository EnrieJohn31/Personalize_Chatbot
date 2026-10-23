<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;

class DeleteConversationsRequest extends FormRequest
{
    public const MAX_IDS = 100;

    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_IDS],
            'ids.*' => ['required', 'string', 'uuid', 'distinct'],
        ];
    }
}
