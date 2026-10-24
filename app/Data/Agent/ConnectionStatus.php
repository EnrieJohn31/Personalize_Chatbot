<?php

namespace App\Data\Agent;

/** Engine-held sign-in state of one provider connection (contracts/v1/connection-status.schema.json). */
final readonly class ConnectionStatus
{
    public const STATUSES = ['connected', 'not_connected', 'unreadable', 'unreachable'];

    private const MAX_MODELS = 500;

    /**
     * @param  int|null  $expiresAt  Unix milliseconds; the engine renews the token automatically
     * @param  list<string>  $models
     */
    public function __construct(
        public string $connectionId,
        public string $provider,
        public string $status,
        public ?int $expiresAt,
        public array $models,
    ) {}

    /** Returns null unless the payload is exactly a v1 status of this connection and provider. */
    public static function fromPayload(mixed $payload, string $connectionId, string $provider): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);
        if ($keys !== ['connectionId', 'contractVersion', 'expiresAt', 'models', 'provider', 'status']) {
            return null;
        }

        $valid = $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
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

        return new self($connectionId, $provider, $payload['status'], $payload['expiresAt'], $models);
    }

    public function isConnected(): bool
    {
        return $this->status === 'connected';
    }
}
