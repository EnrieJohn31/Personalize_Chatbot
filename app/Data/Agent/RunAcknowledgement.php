<?php

namespace App\Data\Agent;

/** Engine acknowledgement (contracts/v1/run-acknowledgement.schema.json). */
final readonly class RunAcknowledgement
{
    public function __construct(
        public string $runId,
        public string $status,
        public bool $duplicate,
    ) {}

    /**
     * Parse a decoded response body. Returns null unless it is exactly a v1 acknowledgement
     * for $runId with one of the expected statuses.
     *
     * @param  list<string>  $expectedStatuses
     */
    public static function fromPayload(mixed $payload, string $runId, array $expectedStatuses): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);

        $valid = $keys === ['contractVersion', 'duplicate', 'runId', 'status']
            && $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
            && $payload['runId'] === $runId
            && is_string($payload['status'])
            && in_array($payload['status'], $expectedStatuses, true)
            && is_bool($payload['duplicate']);

        return $valid ? new self($runId, $payload['status'], $payload['duplicate']) : null;
    }
}
