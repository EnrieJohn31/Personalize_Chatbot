<?php

namespace App\Data\Agent;

/** Outcome of one test message (contracts/v1/connection-test-result.schema.json). */
final readonly class ConnectionTestResult
{
    public const FAILURE_CODES = ['not_connected', 'reauth_required', 'credentials_unreadable', 'provider_error', 'timeout'];

    private const MAX_TEXT_LENGTH = 500;

    public function __construct(
        public string $connectionId,
        public string $provider,
        public string $modelId,
        public bool $ok,
        public int $latencyMs,
        public ?string $reply,
        public ?string $errorCode,
        public ?string $errorMessage,
    ) {}

    /** Returns null unless the payload is exactly a consistent v1 result for this test. */
    public static function fromPayload(mixed $payload, string $connectionId, string $provider, string $modelId): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);
        if ($keys !== ['connectionId', 'contractVersion', 'error', 'latencyMs', 'modelId', 'outcome', 'provider', 'reply']) {
            return null;
        }

        $valid = $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
            && $payload['connectionId'] === $connectionId
            && $payload['provider'] === $provider
            && $payload['modelId'] === $modelId
            && is_int($payload['latencyMs'])
            && $payload['latencyMs'] >= 0;
        if (! $valid) {
            return null;
        }

        $reply = $payload['reply'];
        $error = $payload['error'];

        if ($payload['outcome'] === 'ok') {
            $consistent = $error === null && ($reply === null || (is_string($reply) && mb_strlen($reply) <= self::MAX_TEXT_LENGTH));

            return $consistent ? new self($connectionId, $provider, $modelId, true, $payload['latencyMs'], $reply, null, null) : null;
        }

        if ($payload['outcome'] !== 'failed' || $reply !== null || ! is_array($error)) {
            return null;
        }

        $errorKeys = array_keys($error);
        sort($errorKeys);
        $code = $error['code'] ?? null;
        $message = $error['message'] ?? null;
        $consistent = $errorKeys === ['code', 'message']
            && is_string($code)
            && in_array($code, self::FAILURE_CODES, true)
            && is_string($message)
            && mb_strlen($message) <= self::MAX_TEXT_LENGTH;

        return $consistent ? new self($connectionId, $provider, $modelId, false, $payload['latencyMs'], null, $code, $message) : null;
    }
}
