<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;

class PaginatedRequest extends FormRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
        ];
    }
}
