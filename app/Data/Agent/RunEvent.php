<?php

namespace App\Data\Agent;

/** One normalized engine event (contracts/v1/run-event.schema.json). */
final readonly class RunEvent
{
    public const TYPES = [
        'run.started',
        'run.progress',
        'tool.started',
        'tool.finished',
        'source.added',
        'assistant.delta',
        'assistant.final',
        'run.completed',
        'run.failed',
        'run.cancelled',
    ];

    public const TERMINAL_TYPES = ['run.completed', 'run.failed', 'run.cancelled'];

    private const PROGRESS_STAGES = ['preparing', 'retrieving', 'answering'];

    private const CODE_PATTERN = '/\A[a-z][a-z0-9_]{0,63}\z/';

    private const TOOL_CALL_ID_PATTERN = '/\A[\x21-\x7e]{1,256}\z/';

    private const TOOL_NAME_PATTERN = '/\A[a-z][a-z0-9_]{0,63}\z/';

    private const TOOL_OUTCOMES = ['ok', 'blocked', 'invalid_arguments', 'failed', 'timeout'];

    private const EVIDENCE_ID_PATTERN = '/\A[A-Za-z0-9][A-Za-z0-9._:-]{0,63}\z/';

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
            'tool.started' => self::hasExactly($data, ['name', 'toolCallId'])
                && self::isToolCallId($data['toolCallId'])
                && is_string($data['name']) && preg_match(self::TOOL_NAME_PATTERN, $data['name']) === 1,
            'tool.finished' => self::validToolFinished($data),
            'source.added' => self::validSource($data),
            default => false,
        };
    }

    /** @param  array<mixed>  $data */
    private static function validToolFinished(array $data): bool
    {
        $message = $data['message'] ?? null;

        return self::hasExactly($data, ['message', 'name', 'outcome', 'toolCallId'])
            && self::isToolCallId($data['toolCallId'])
            && is_string($data['name']) && $data['name'] !== '' && mb_strlen($data['name']) <= 128
            && in_array($data['outcome'], self::TOOL_OUTCOMES, true)
            && ($message === null || (is_string($message) && $message !== '' && mb_strlen($message) <= 500));
    }

    /** @param  array<mixed>  $data */
    private static function validSource(array $data): bool
    {
        $title = $data['title'] ?? null;
        $locator = $data['locator'] ?? null;

        return self::hasExactly($data, ['checkedAt', 'evidenceId', 'locator', 'title', 'toolCallId'])
            && self::isToolCallId($data['toolCallId'])
            && is_string($data['evidenceId']) && preg_match(self::EVIDENCE_ID_PATTERN, $data['evidenceId']) === 1
            && is_string($title) && $title !== '' && mb_strlen($title) <= 200
            && is_string($locator) && $locator !== '' && mb_strlen($locator) <= 500
            && is_string($data['checkedAt']) && preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $data['checkedAt']) === 1;
    }

    /**
     * @param  array<mixed>  $data
     * @param  list<string>  $keys  sorted
     */
    private static function hasExactly(array $data, array $keys): bool
    {
        $present = array_keys($data);
        sort($present);

        return $present === $keys;
    }

    private static function isToolCallId(mixed $value): bool
    {
        return is_string($value) && preg_match(self::TOOL_CALL_ID_PATTERN, $value) === 1;
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
