<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;

class ShowConversationRequest extends FormRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'before_sequence' => ['sometimes', 'integer', 'min:1', 'max:'.PHP_INT_MAX],
        ];
    }
}
