<?php

namespace App\Data\Agent;

/** The administrator's local model server as the engine reports it (contracts/v1/local-model-status.schema.json). */
final readonly class LocalModelStatus
{
    private const MAX_MODELS = 200;

    /** @param  list<string>  $models */
    public function __construct(
        public bool $configured,
        public ?string $name,
        public ?string $baseUrl,
        public bool $reachable,
        public array $models,
        public ?string $error,
    ) {}

    /** Returns null unless the payload is exactly a v1 local model status. */
    public static function fromPayload(mixed $payload): ?self
    {
        if (! is_array($payload)) {
            return null;
        }

        $keys = array_keys($payload);
        sort($keys);
        if ($keys !== ['baseUrl', 'configured', 'contractVersion', 'error', 'models', 'name', 'reachable']) {
            return null;
        }

        $name = $payload['name'];
        $baseUrl = $payload['baseUrl'];
        $error = $payload['error'];
        $valid = $payload['contractVersion'] === RunRequest::CONTRACT_VERSION
            && is_bool($payload['configured'])
            && is_bool($payload['reachable'])
            && ($name === null || (is_string($name) && $name !== '' && mb_strlen($name) <= 64))
            && ($baseUrl === null || (is_string($baseUrl) && preg_match('#\Ahttps?://#', $baseUrl) === 1 && strlen($baseUrl) <= 512))
            && ($error === null || (is_string($error) && mb_strlen($error) <= 500))
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

        return new self($payload['configured'], $name, $baseUrl, $payload['reachable'], $models, $error);
    }
}
