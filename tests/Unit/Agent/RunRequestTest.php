<?php

namespace Tests\Unit\Agent;

use App\Data\Agent\RunRequest;
use Closure;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class RunRequestTest extends TestCase
{
    public function test_serialization_matches_the_shared_contract_example_exactly(): void
    {
        $example = self::contract('examples/run-request.json');
        $request = self::fromContract($example);

        $this->assertSame($example, $request->toArray());
        $this->assertSame($example, json_decode($request->toJson(), true, flags: JSON_THROW_ON_ERROR));
    }

    public function test_bounds_match_the_v1_schema(): void
    {
        $schema = self::contract('run-request.schema.json');
        $properties = $schema['properties'];

        $this->assertSame(RunRequest::CONTRACT_VERSION, $properties['contractVersion']['const']);
        $this->assertSame(RunRequest::MAX_MESSAGES, $properties['messages']['maxItems']);
        $this->assertSame(RunRequest::MAX_MESSAGE_LENGTH, $properties['messages']['items']['properties']['content']['maxLength']);
        $this->assertSame(RunRequest::MAX_CAPABILITIES, $properties['capabilities']['maxItems']);
        $this->assertSame(RunRequest::UUID_PATTERN, '/\A'.trim($schema['$defs']['uuid']['pattern'], '^$').'\z/');

        $example = self::contract('examples/run-request.json');
        foreach ($properties['limits']['properties'] as $name => ['minimum' => $minimum, 'maximum' => $maximum]) {
            foreach ([$minimum, $maximum] as $accepted) {
                self::fromContract(self::withLimit($example, $name, $accepted));
            }
            foreach ([$minimum - 1, $maximum + 1] as $rejected) {
                try {
                    self::fromContract(self::withLimit($example, $name, $rejected));
                    $this->fail("Limit [$name] accepted out-of-range value $rejected.");
                } catch (InvalidArgumentException) {
                    $this->addToAssertionCount(1);
                }
            }
        }
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidSnapshots')]
    public function test_invalid_snapshots_are_refused_before_signing(Closure $change): void
    {
        $this->expectException(InvalidArgumentException::class);

        self::fromContract($change(self::contract('examples/run-request.json')))->toJson();
    }

    /** @return array<string, array{Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidSnapshots(): array
    {
        $message = fn (array $contract, array $overrides): array => [...$contract, 'messages' => [[...$contract['messages'][0], ...$overrides]]];

        return [
            'uppercase run ID' => [fn (array $c) => [...$c, 'runId' => strtoupper($c['runId'])]],
            'user ID zero' => [fn (array $c) => [...$c, 'userId' => '0']],
            'user ID with trailing newline' => [fn (array $c) => [...$c, 'userId' => "42\n"]],
            'connection that is not a UUID' => [fn (array $c) => [...$c, 'connectionId' => 'credential-reference']],
            'model ID with spaces' => [fn (array $c) => [...$c, 'model' => ['provider' => 'simulated', 'id' => 'two words']]],
            'duplicate capabilities' => [fn (array $c) => [...$c, 'capabilities' => ['lookup_reference', 'lookup_reference']]],
            'capability with uppercase' => [fn (array $c) => [...$c, 'capabilities' => ['Lookup']]],
            'no messages' => [fn (array $c) => [...$c, 'messages' => []]],
            'too many messages' => [fn (array $c) => [...$c, 'messages' => array_map(
                fn (int $i): array => [...$c['messages'][0], 'id' => sprintf('0199f29f-2a00-7000-8000-%012d', $i)],
                range(1, RunRequest::MAX_MESSAGES + 1),
            )]],
            'system role' => [fn (array $c) => $message($c, ['role' => 'system'])],
            'empty content' => [fn (array $c) => $message($c, ['content' => ''])],
            'content too long' => [fn (array $c) => $message($c, ['content' => str_repeat('é', RunRequest::MAX_MESSAGE_LENGTH + 1)])],
            'duplicate message IDs' => [fn (array $c) => [...$c, 'messages' => [$c['messages'][0], $c['messages'][0]]]],
            'assistant message last' => [fn (array $c) => [...$c, 'messages' => array_slice($c['messages'], 0, 2)]],
            'invalid UTF-8 content' => [fn (array $c) => $message($c, ['content' => "\xB1\x31"])],
            'encoded body over the engine limit' => [fn (array $c) => [...$c, 'messages' => array_map(
                fn (int $i): array => [...$c['messages'][0], 'id' => sprintf('0199f29f-2a00-7000-8000-%012d', $i), 'content' => str_repeat('x', 60_000)],
                range(1, 18),
            )]],
        ];
    }

    public function test_content_length_counts_characters_not_bytes(): void
    {
        $example = self::contract('examples/run-request.json');
        $example['messages'] = [[...$example['messages'][0], 'content' => str_repeat('é', RunRequest::MAX_MESSAGE_LENGTH)]];

        $this->assertSame(RunRequest::MAX_MESSAGE_LENGTH, mb_strlen(self::fromContract($example)->messages[0]['content']));
    }

    /** @return array<string, mixed> */
    private static function contract(string $path): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 3).'/contracts/v1/'.$path), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @param  array<string, mixed>  $contract
     * @return array<string, mixed>
     */
    private static function withLimit(array $contract, string $name, int $value): array
    {
        $contract['limits'][$name] = $value;

        return $contract;
    }

    /** @param  array<string, mixed>  $contract */
    private static function fromContract(array $contract): RunRequest
    {
        return new RunRequest(
            runId: $contract['runId'],
            conversationId: $contract['conversationId'],
            userId: $contract['userId'],
            profileId: $contract['profile']['id'],
            profileVersion: $contract['profile']['version'],
            modelProvider: $contract['model']['provider'],
            modelId: $contract['model']['id'],
            connectionId: $contract['connectionId'],
            capabilities: $contract['capabilities'],
            messages: $contract['messages'],
            limits: $contract['limits'],
        );
    }
}
