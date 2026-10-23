<?php

namespace App\Data\Agent;

/** One provider sign-in as the engine reports it (contracts/v1/connection-login.schema.json). */
final readonly class LoginState
{
    public const STATES = ['starting', 'waiting_for_user', 'exchanging', 'connected', 'failed', 'cancelled'];

    /** States in which the sign-in can still finish; the page keeps polling while in one. */
    public const ACTIVE_STATES = ['starting', 'waiting_for_user', 'exchanging'];

    private const MAX_URL_LENGTH = 4096;

    private const MAX_ERROR_LENGTH = 500;

    /**
     * @param  string|null  $authUrl  the provider's sign-in page, present only while waiting for the user
     * @param  int  $expiresAt  Unix milliseconds when an unfinished sign-in is cancelled
     */
    public function __construct(
        public string $connectionId,
        public string $provider,
        public string $state,
        public ?string $authUrl,
        public ?string $error,
        public int $expiresAt,
    ) {}

    /** Returns null unless the payload is exactly a v1 sign-in state of this connection and provider. */
    public static function fromPayload(mixed $payload, string $connectionId, string $provider): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);
        if ($keys !== ['authUrl', 'connectionId', 'contractVersion', 'error', 'expiresAt', 'provider', 'state']) {
            return null;
        }

        $state = $payload['state'];
        $authUrl = $payload['authUrl'];
        $error = $payload['error'];
        $waiting = $state === 'waiting_for_user';

        $valid = $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
            && $payload['connectionId'] === $connectionId
            && $payload['provider'] === $provider
            && is_string($state)
            && in_array($state, self::STATES, true)
            // The engine shows the sign-in page only while it waits for the user.
            && ($waiting
                ? is_string($authUrl) && str_starts_with($authUrl, 'https://') && strlen($authUrl) <= self::MAX_URL_LENGTH
                : $authUrl === null)
            && ($error === null || (is_string($error) && mb_strlen($error) <= self::MAX_ERROR_LENGTH))
            && is_int($payload['expiresAt'])
            && $payload['expiresAt'] >= 0;

        return $valid ? new self($connectionId, $provider, $state, $authUrl, $error, $payload['expiresAt']) : null;
    }

    public function isActive(): bool
    {
        return in_array($this->state, self::ACTIVE_STATES, true);
    }
}
