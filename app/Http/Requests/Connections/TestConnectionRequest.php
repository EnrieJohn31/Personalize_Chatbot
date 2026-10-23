<?php

namespace App\Http\Requests\Connections;

use App\Data\Agent\RunRequest;
use Illuminate\Foundation\Http\FormRequest;

class TestConnectionRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        return [
            'model_id' => ['required', 'string', 'regex:'.RunRequest::MODEL_ID_PATTERN],
        ];
    }
}
