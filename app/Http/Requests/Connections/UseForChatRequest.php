<?php

namespace App\Http\Requests\Connections;

use App\Data\Agent\RunRequest;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** The connection and model chat should use; an empty provider returns to the built-in default. */
class UseForChatRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        /** @var array<string, mixed> $providers */
        $providers = config('assistant.connection_providers');

        return [
            'provider' => ['nullable', 'string', Rule::in(array_keys($providers))],
            'model_id' => ['nullable', 'required_with:provider', 'string', 'regex:'.RunRequest::MODEL_ID_PATTERN],
        ];
    }
}
