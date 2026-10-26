<?php

namespace App\Data\Agent;

/** Engine-held sign-in state of one provider connection (contracts/v1/connection-status.schema.json). */
final readonly class ConnectionStatus
{
    public const STATUSES = ['connected', 'not_connected', 'unreadable', 'unreachable', 'reauth_required'];

    private const MAX_MODELS = 500;

    /** The payload's keys in sorted order; engines from before the refused-renewal record omit `rejection`. */
    private const KEYS = ['connectionId', 'contractVersion', 'expiresAt', 'models', 'provider', 'status'];

    private const KEYS_WITH_REJECTION = ['connectionId', 'contractVersion', 'expiresAt', 'models', 'provider', 'rejection', 'status'];

    private const REASON_PATTERN = '/\A[a-z][a-z0-9_]{0,63}\z/';

    private const MAX_REJECTION_MESSAGE_LENGTH = 500;

    /**
     * @param  int|null  $expiresAt  Unix milliseconds; the engine renews the token automatically
     * @param  list<string>  $models
     * @param  array{reason: string, message: string, at: int}|null  $rejection  why and when (Unix milliseconds) the
     *                                                                           provider refused to renew the sign-in
     */
    public function __construct(
        public string $connectionId,
        public string $provider,
        public string $status,
        public ?int $expiresAt,
        public array $models,
        public ?array $rejection = null,
    ) {}

    /** Returns null unless the payload is exactly a v1 status of this connection and provider. */
    public static function fromPayload(mixed $payload, string $connectionId, string $provider): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);
        if ($keys !== self::KEYS && $keys !== self::KEYS_WITH_REJECTION) {
            return null;
        }

        $rejection = self::rejection($payload['rejection'] ?? null);
        $valid = $rejection !== false
            && $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
            && $payload['connectionId'] === $connectionId
            && $payload['provider'] === $provider
            && is_string($payload['status'])
            && in_array($payload['status'], self::STATUSES, true)
            && ($payload['expiresAt'] === null || (is_int($payload['expiresAt']) && $payload['expiresAt'] >= 0))
            && is_array($payload['models'])
            && array_is_list($payload['models'])
            && count($payload['models']) <= self::MAX_MODELS;
        if (! $valid) {
            return null;
        }

        $models = [];
        foreach ($payload['models'] as $model) {
            if (! is_string($model) || preg_match(RunRequest::MODEL_ID_PATTERN, $model) !== 1) {
                return null;
            }
            $models[] = $model;
        }

        return new self($connectionId, $provider, $payload['status'], $payload['expiresAt'], $models, $rejection);
    }

    public function isConnected(): bool
    {
        return $this->status === 'connected';
    }

    /**
     * Null when the engine reports no refused renewal, false when the value breaks the contract.
     *
     * @return array{reason: string, message: string, at: int}|false|null
     */
    private static function rejection(mixed $value): array|false|null
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            return false;
        }

        $keys = array_keys($value);
        sort($keys);
        $valid = $keys === ['at', 'message', 'reason']
            && is_string($value['reason']) && preg_match(self::REASON_PATTERN, $value['reason']) === 1
            && is_string($value['message']) && $value['message'] !== '' && mb_strlen($value['message']) <= self::MAX_REJECTION_MESSAGE_LENGTH
            && is_int($value['at']) && $value['at'] >= 0;

        return $valid ? ['reason' => $value['reason'], 'message' => $value['message'], 'at' => $value['at']] : false;
    }
}
