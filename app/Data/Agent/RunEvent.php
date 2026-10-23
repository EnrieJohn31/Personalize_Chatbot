<?php

namespace App\Data\Agent;

/** One normalized engine event (contracts/v1/run-event.schema.json). */
final readonly class RunEvent
{
    public const TYPES = [
        'run.started',
        'run.progress',
        'assistant.delta',
        'assistant.final',
        'run.completed',
        'run.failed',
        'run.cancelled',
    ];

    public const TERMINAL_TYPES = ['run.completed', 'run.failed', 'run.cancelled'];

    private const PROGRESS_STAGES = ['preparing', 'retrieving', 'answering'];

    private const CODE_PATTERN = '/\A[a-z][a-z0-9_]{0,63}\z/';

    /** @param  array<string, mixed>  $data */
    public function __construct(
        public string $runId,
        public int $sequence,
        public string $type,
        public array $data,
    ) {}

    public function isTerminal(): bool
    {
        return in_array($this->type, self::TERMINAL_TYPES, true);
    }

    /**
     * Parses a decoded event. Returns null unless it is exactly a v1 event for $runId whose
     * sequence directly follows $previousSequence, with data valid for its type.
     */
    public static function fromPayload(mixed $payload, string $runId, int $previousSequence): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);

        if ($keys !== ['contractVersion', 'data', 'runId', 'sequence', 'type']
            || $payload['contractVersion'] !== RunRequest::CONTRACT_VERSION
            || $payload['runId'] !== $runId
            || $payload['sequence'] !== $previousSequence + 1
            || ! is_string($payload['type'])
            || ! is_array($payload['data'])
            || ! self::validData($payload['type'], $payload['data'])) {
            return null;
        }

        /** @var array<string, mixed> $data */
        $data = $payload['data'];

        return new self($runId, $previousSequence + 1, $payload['type'], $data);
    }

    /** @param  array<mixed>  $data */
    private static function validData(string $type, array $data): bool
    {
        $text = $data['text'] ?? null;

        return match ($type) {
            'run.started', 'run.completed', 'run.cancelled' => $data === [],
            'run.progress' => array_keys($data) === ['stage'] && in_array($data['stage'], self::PROGRESS_STAGES, true),
            'assistant.delta' => array_keys($data) === ['text'] && is_string($text) && $text !== '' && mb_strlen($text) <= 16_384,
            'assistant.final' => array_keys($data) === ['text'] && is_string($text) && mb_strlen($text) <= 200_000,
            'run.failed' => self::validFailure($data),
            default => false,
        };
    }

    /** @param  array<mixed>  $data */
    private static function validFailure(array $data): bool
    {
        $keys = array_keys($data);
        sort($keys);

        return $keys === ['code', 'message']
            && is_string($data['code']) && preg_match(self::CODE_PATTERN, $data['code']) === 1
            && is_string($data['message']) && $data['message'] !== '' && mb_strlen($data['message']) <= 500;
    }
}
