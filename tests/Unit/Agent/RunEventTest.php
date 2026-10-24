<?php

namespace Tests\Unit\Agent;

use App\Data\Agent\RunEvent;
use Closure;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class RunEventTest extends TestCase
{
    private const RUN_ID = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e';

    private const TOOL_RUN_ID = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0f';

    public function test_the_shared_example_stream_parses_in_order(): void
    {
        $previous = 0;
        $types = [];

        foreach (self::examples() as $payload) {
            $event = RunEvent::fromPayload($payload, self::RUN_ID, $previous);
            $this->assertNotNull($event, "event {$payload['sequence']} was rejected");
            $previous = $event->sequence;
            $types[] = $event->type;
        }

        $this->assertSame(['run.started', 'run.progress', 'assistant.delta', 'assistant.delta', 'assistant.final', 'run.completed'], $types);
        $this->assertTrue(RunEvent::fromPayload(self::examples()[5], self::RUN_ID, 5)?->isTerminal());
    }

    public function test_the_shared_tool_example_stream_parses_in_order(): void
    {
        $previous = 0;
        $types = [];

        foreach (self::examples('run-events-tool.json') as $payload) {
            $event = RunEvent::fromPayload($payload, self::TOOL_RUN_ID, $previous);
            $this->assertNotNull($event, "event {$payload['sequence']} was rejected");
            $previous = $event->sequence;
            $types[] = $event->type;
        }

        $this->assertSame(['run.started', 'run.progress', 'run.progress', 'tool.started', 'source.added', 'tool.finished', 'run.progress', 'assistant.delta', 'assistant.final', 'run.completed'], $types);
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidToolEvents')]
    public function test_tool_events_outside_the_contract_are_rejected(int $index, Closure $change): void
    {
        $this->assertNull(RunEvent::fromPayload($change(self::examples('run-events-tool.json')[$index]), self::TOOL_RUN_ID, $index));
    }

    /** @return array<string, array{int, Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidToolEvents(): array
    {
        $data = fn (array $event, array $changes): array => [...$event, 'data' => [...$event['data'], ...$changes]];

        return [
            'started with arguments' => [3, fn (array $e) => $data($e, ['arguments' => ['query' => 'x']])],
            'started with an unsafe name' => [3, fn (array $e) => $data($e, ['name' => 'Lookup Reference'])],
            'call ID with a space' => [3, fn (array $e) => $data($e, ['toolCallId' => 'call 1'])],
            'source without a locator' => [4, fn (array $e) => [...$e, 'data' => array_diff_key($e['data'], ['locator' => true])]],
            'source with a loose date' => [4, fn (array $e) => $data($e, ['checkedAt' => 'yesterday'])],
            'finished with result text' => [5, fn (array $e) => $data($e, ['result' => 'SAMPLE-001'])],
            'finished with an unknown outcome' => [5, fn (array $e) => $data($e, ['outcome' => 'maybe'])],
            'finished with an empty message' => [5, fn (array $e) => $data($e, ['outcome' => 'blocked', 'message' => ''])],
        ];
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidEvents')]
    public function test_events_outside_the_contract_are_rejected(int $index, Closure $change, int $previous): void
    {
        $this->assertNull(RunEvent::fromPayload($change(self::examples()[$index]), self::RUN_ID, $previous));
    }

    /** @return array<string, array{int, Closure(array<string, mixed>): array<string, mixed>, int}> */
    public static function invalidEvents(): array
    {
        $same = fn (array $event): array => $event;

        return [
            'another contract version' => [0, fn (array $e) => [...$e, 'contractVersion' => 2], 0],
            'another run' => [0, fn (array $e) => [...$e, 'runId' => '0199f2a0-7c1e-7a3b-9d4e-000000000000'], 0],
            'repeated sequence' => [0, $same, 1],
            'skipped sequence' => [2, $same, 1],
            'unknown type' => [0, fn (array $e) => [...$e, 'type' => 'provider.raw'], 0],
            'extra field' => [0, fn (array $e) => [...$e, 'reasoning' => 'hidden'], 0],
            'data on an empty event' => [0, fn (array $e) => [...$e, 'data' => ['leak' => true]], 0],
            'unknown progress stage' => [1, fn (array $e) => [...$e, 'data' => ['stage' => 'thinking']], 1],
            'empty delta' => [2, fn (array $e) => [...$e, 'data' => ['text' => '']], 2],
            'delta with extra data' => [2, fn (array $e) => [...$e, 'data' => ['text' => 'a', 'raw' => 'b']], 2],
            'final without text' => [4, fn (array $e) => [...$e, 'data' => []], 4],
            'failure without code' => [5, fn (array $e) => [...$e, 'type' => 'run.failed', 'data' => ['message' => 'No code.']], 5],
            'failure with an invalid code' => [5, fn (array $e) => [...$e, 'type' => 'run.failed', 'data' => ['code' => 'Bad Code', 'message' => 'x']], 5],
            'not an object' => [0, fn (array $e) => ['run.started'], 0],
        ];
    }

    /** @return list<array<string, mixed>> */
    private static function examples(string $file = 'run-events.json'): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 3)."/contracts/v1/examples/$file"), true, flags: JSON_THROW_ON_ERROR);
    }
}
