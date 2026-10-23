<?php

namespace App\Http\Requests\Chat;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProviderConnectionRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        return [
            'provider' => ['required', 'string', 'max:64', 'regex:/\A[a-z][a-z0-9_-]*\z/'],
            'auth_method' => ['required', Rule::in(['oauth', 'api_key', 'none'])],
            'id' => ['missing'],
            'user_id' => ['missing'],
            'status' => ['missing'],
            'credential_reference' => ['missing'],
            'credentials' => ['missing'],
            'api_key' => ['missing'],
            'access_token' => ['missing'],
            'refresh_token' => ['missing'],
            'password' => ['missing'],
        ];
    }
}
