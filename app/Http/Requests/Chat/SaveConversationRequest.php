<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveConversationRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        return [
            'title' => [$this->isMethod('post') ? 'required' : 'sometimes', 'required', 'string', 'max:200'],
            'provider_connection_id' => [
                'sometimes', 'nullable', 'uuid',
                Rule::exists('provider_connections', 'id')->where('user_id', $this->user()->id),
            ],
            'id' => ['missing'],
            'user_id' => ['missing'],
            'messages' => ['missing'],
        ];
    }
}
