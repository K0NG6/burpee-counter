<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreBurpeeRecordRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Normalize incoming boundary input before running validation rules.
     */
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('user_id'))) {
            $this->merge([
                'user_id' => strtolower(trim($this->input('user_id'))),
            ]);
        }
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'user_id' => ['required', 'uuid'],
            'count' => ['required', 'integer', 'min:1', 'max:10000'],
            'duration_seconds' => ['required', 'integer', 'min:1', 'max:86400'],
        ];
    }
}

