<?php

namespace App\Data\Agent;

use InvalidArgumentException;
use JsonException;

/**
 * Immutable execution snapshot sent to the engine (contracts/v1/run-request.schema.json).
 *
 * The constructor applies the schema's bounds so an invalid snapshot fails in Laravel before
 * it is signed; the engine validates it again independently.
 */
final readonly class RunRequest
{
    public const CONTRACT_VERSION = 1;

    public const MAX_MESSAGES = 200;

    public const MAX_MESSAGE_LENGTH = 64_000;

    public const MAX_CAPABILITIES = 32;

    /** Matches the engine's default request body limit. */
    public const MAX_ENCODED_BYTES = 1_048_576;

    public const UUID_PATTERN = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/';

    private const SLUG_PATTERN = '/\A[a-z][a-z0-9_-]{0,63}\z/';

    private const USER_ID_PATTERN = '/\A[1-9][0-9]{0,19}\z/';

    public const MODEL_ID_PATTERN = '/\A[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}\z/';

    private const CAPABILITY_PATTERN = '/\A[a-z][a-z0-9_]{0,63}\z/';

    /** Inclusive [minimum, maximum] for each limit. */
    private const LIMIT_RANGES = [
        'maxModelRounds' => [1, 16],
        'maxToolCalls' => [0, 32],
        'runDeadlineMs' => [1_000, 600_000],
    ];

    /**
     * @param  list<string>  $capabilities
     * @param  list<array{id: string, role: string, content: string}>  $messages  roles are checked at runtime
     * @param  array{maxModelRounds: int, maxToolCalls: int, runDeadlineMs: int}  $limits
     */
    public function __construct(
        public string $runId,
        public string $conversationId,
        public string $userId,
        public string $profileId,
        public int $profileVersion,
        public string $modelProvider,
        public string $modelId,
        public ?string $connectionId,
        public array $capabilities,
        public array $messages,
        public array $limits,
    ) {
        self::require(self::isUuid($runId), 'runId must be a lowercase UUID.');
        self::require(self::isUuid($conversationId), 'conversationId must be a lowercase UUID.');
        self::require($connectionId === null || self::isUuid($connectionId), 'connectionId must be null or a lowercase UUID.');
        self::require(preg_match(self::USER_ID_PATTERN, $userId) === 1, 'userId must be a positive decimal string.');
        self::require(preg_match(self::SLUG_PATTERN, $profileId) === 1, 'profileId must be a slug.');
        self::require($profileVersion >= 1 && $profileVersion <= 1_000_000, 'profileVersion is out of range.');
        self::require(preg_match(self::SLUG_PATTERN, $modelProvider) === 1, 'modelProvider must be a slug.');
        self::require(preg_match(self::MODEL_ID_PATTERN, $modelId) === 1, 'modelId has an unsupported format.');

        self::require(count($capabilities) <= self::MAX_CAPABILITIES, 'Too many capabilities.');
        self::require(count(array_unique($capabilities)) === count($capabilities), 'Capabilities must be unique.');
        foreach ($capabilities as $capability) {
            self::require(preg_match(self::CAPABILITY_PATTERN, $capability) === 1, "Invalid capability [$capability].");
        }

        self::require($messages !== [] && count($messages) <= self::MAX_MESSAGES, 'Between 1 and '.self::MAX_MESSAGES.' messages are required.');
        foreach ($messages as $message) {
            self::require(self::isUuid($message['id']), 'Message IDs must be lowercase UUIDs.');
            self::require(in_array($message['role'], ['user', 'assistant'], true), 'Message roles must be user or assistant.');
            $length = mb_strlen($message['content']);
            self::require($length >= 1 && $length <= self::MAX_MESSAGE_LENGTH, 'Message content is empty or too long.');
        }
        self::require(count(array_unique(array_column($messages, 'id'))) === count($messages), 'Message IDs must be unique.');
        $last = end($messages);
        self::require($last !== false && $last['role'] === 'user', 'The final message must have role user.');

        foreach (self::LIMIT_RANGES as $name => [$minimum, $maximum]) {
            self::require($limits[$name] >= $minimum && $limits[$name] <= $maximum, "Limit [$name] is out of range.");
        }
    }

    public static function isUuid(string $value): bool
    {
        return preg_match(self::UUID_PATTERN, $value) === 1;
    }

    /** @return array<string, mixed> Contract field order, matching contracts/v1/examples. */
    public function toArray(): array
    {
        return [
            'contractVersion' => self::CONTRACT_VERSION,
            'runId' => $this->runId,
            'conversationId' => $this->conversationId,
            'userId' => $this->userId,
            'profile' => ['id' => $this->profileId, 'version' => $this->profileVersion],
            'model' => ['provider' => $this->modelProvider, 'id' => $this->modelId],
            'connectionId' => $this->connectionId,
            'capabilities' => $this->capabilities,
            'messages' => array_map(fn (array $message): array => [
                'id' => $message['id'],
                'role' => $message['role'],
                'content' => $message['content'],
            ], $this->messages),
            'limits' => [
                'maxModelRounds' => $this->limits['maxModelRounds'],
                'maxToolCalls' => $this->limits['maxToolCalls'],
                'runDeadlineMs' => $this->limits['runDeadlineMs'],
            ],
        ];
    }

    /** The exact bytes that are signed and sent. */
    public function toJson(): string
    {
        try {
            $json = json_encode($this->toArray(), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } catch (JsonException $exception) {
            throw new InvalidArgumentException('The run request cannot be encoded as JSON.', previous: $exception);
        }

        self::require(strlen($json) <= self::MAX_ENCODED_BYTES, 'The encoded run request exceeds the engine body limit.');

        return $json;
    }

    private static function require(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new InvalidArgumentException($message);
        }
    }
}
