<?php

namespace App\Services\Ai;

use InvalidArgumentException;

/**
 * AGENT-HMAC-SHA256-V1 request signing, shared with agent-service/src/http/service-auth.ts.
 * contracts/v1/examples/signature.json pins the wire format for both runtimes.
 */
final readonly class ServiceRequestSigner
{
    public const SCHEME = 'AGENT-HMAC-SHA256-V1';

    public const MIN_KEY_LENGTH = 32;

    public function __construct(#[\SensitiveParameter] private string $key)
    {
        if (strlen($key) < self::MIN_KEY_LENGTH) {
            throw new InvalidArgumentException('Signing keys must be at least '.self::MIN_KEY_LENGTH.' characters.');
        }
    }

    public static function canonicalRequest(string $timestamp, string $method, string $target, string $body): string
    {
        return implode("\n", [self::SCHEME, $timestamp, strtoupper($method), $target, hash('sha256', $body)]);
    }

    public function signature(string $timestamp, string $method, string $target, string $body): string
    {
        return 'v1='.hash_hmac('sha256', self::canonicalRequest($timestamp, $method, $target, $body), $this->key);
    }

    /** @return array{X-Agent-Timestamp: string, X-Agent-Signature: string} */
    public function headers(string $method, string $target, string $body, int $timestamp): array
    {
        return [
            'X-Agent-Timestamp' => (string) $timestamp,
            'X-Agent-Signature' => $this->signature((string) $timestamp, $method, $target, $body),
        ];
    }
}
