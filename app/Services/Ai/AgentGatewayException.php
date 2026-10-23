<?php

namespace App\Services\Ai;

use RuntimeException;
use Throwable;

/**
 * A failed engine call. `reason` is either a Laravel-side code (not_configured, unavailable,
 * invalid_response) or the engine's stable error code from contracts/v1/error.schema.json.
 */
final class AgentGatewayException extends RuntimeException
{
    /**
     * @param  list<array{path: string, message: string}>  $details
     */
    private function __construct(
        public readonly string $reason,
        string $message,
        public readonly ?int $status = null,
        public readonly array $details = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function notConfigured(): self
    {
        return new self('not_configured', 'AGENT_REQUEST_SIGNING_KEY must be set to at least '.ServiceRequestSigner::MIN_KEY_LENGTH.' characters.');
    }

    public static function unavailable(?Throwable $previous, ?int $status = null): self
    {
        return new self('unavailable', 'The engine could not be reached or did not answer in time.', $status, previous: $previous);
    }

    /**
     * @param  list<array{path: string, message: string}>  $details
     */
    public static function rejected(int $status, string $code, string $message, array $details = []): self
    {
        return new self($code, "The engine rejected the request: $message", $status, $details);
    }

    public static function invalidResponse(int $status, string $problem): self
    {
        return new self('invalid_response', "The engine response does not match the contract: $problem", $status);
    }

    /** The event stream ended or stalled before the run's terminal event; reading again resumes it. */
    public static function streamInterrupted(?Throwable $previous = null): self
    {
        return new self('stream_interrupted', 'The engine event stream ended before the run finished.', previous: $previous);
    }

    /** Whether resubmitting the same run ID, or reading its events again, is a reasonable next step. */
    public function isRetryable(): bool
    {
        return in_array($this->reason, ['unavailable', 'capacity_exhausted', 'stream_interrupted'], true);
    }
}
