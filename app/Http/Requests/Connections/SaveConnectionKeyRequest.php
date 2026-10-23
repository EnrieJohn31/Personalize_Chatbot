<?php

namespace App\Http\Requests\Connections;

use Illuminate\Foundation\Http\FormRequest;

/** An API key for an API-key provider such as OpenCode. It passes through to the engine and is never stored here. */
class SaveConnectionKeyRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        // Matches the engine's key contract: printable ASCII without spaces.
        return [
            'api_key' => ['required', 'string', 'min:8', 'max:512', 'regex:/\A[!-~]+\z/'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'api_key.required' => __('Paste your API key.'),
            'api_key.min' => __('That key is too short. Copy the whole key.'),
            'api_key.regex' => __('The key cannot contain spaces. Copy it again without extra characters.'),
        ];
    }
}
