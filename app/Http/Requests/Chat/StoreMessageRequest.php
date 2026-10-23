<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;

class StoreMessageRequest extends FormRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'content' => ['required', 'string', 'max:12000'],
            'id' => ['missing'],
            'user_id' => ['missing'],
            'conversation_id' => ['missing'],
            'role' => ['missing'],
            'sequence' => ['missing'],
            'canonical_content' => ['missing'],
        ];
    }
}
