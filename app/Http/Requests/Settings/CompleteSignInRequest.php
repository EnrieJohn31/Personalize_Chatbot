<?php

namespace App\Http\Requests\Settings;

use Illuminate\Foundation\Http\FormRequest;

/** The browser's final address after ChatGPT sign-in, pasted when the redirect could not finish by itself. */
class CompleteSignInRequest extends FormRequest
{
    /** @return array<string, array<mixed>> */
    public function rules(): array
    {
        // The engine checks that the address belongs to its pending sign-in and explains a mismatch.
        return [
            'redirect_url' => ['required', 'string', 'max:4096'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'redirect_url.required' => __('Paste the address from the browser tab that finished signing in.'),
        ];
    }
}
