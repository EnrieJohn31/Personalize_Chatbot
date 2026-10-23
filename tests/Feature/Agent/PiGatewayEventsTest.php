<?php

namespace Tests\Feature\Agent;

use App\Contracts\AgentGateway;
use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\ServiceRequestSigner;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PiGatewayEventsTest extends TestCase
{
    private const KEY = 'test-request-signing-key-0123456789abcdef';

    private const RUN_ID = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e';

    private const EVENTS_URL = 'http://agent.test:3101/internal/runs/'.self::RUN_ID.'/events';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'assistant.agent_url' => 'http://agent.test:3101',
            'assistant.agent_request_signing_key' => self::KEY,
        ]);
    }

    public function test_events_are_read_with_a_signed_get_that_covers_the_query(): void
    {
        $this->freezeTime();
        Http::fake([self::EVENTS_URL.'*' => Http::response($this->ndjson(), 200, ['Content-Type' => 'application/x-ndjson'])]);

        $types = array_map(fn ($event) => $event->type, iterator_to_array($this->gateway()->events(self::RUN_ID), false));

        $this->assertSame(['run.started', 'run.progress', 'assistant.delta', 'assistant.delta', 'assistant.final', 'run.completed'], $types);
        Http::assertSent(function (Request $request): bool {
            $target = '/internal/runs/'.self::RUN_ID.'/events?after=0';
            $signature = (new ServiceRequestSigner(self::KEY))->signature((string) now()->getTimestamp(), 'GET', $target, '');

            return $request->method() === 'GET'
                && $request->url() === self::EVENTS_URL.'?after=0'
                && $request->body() === ''
                && $request->header('X-Agent-Signature') === [$signature];
        });
    }

    public function test_heartbeat_lines_are_skipped_and_reading_stops_at_the_terminal_event(): void
    {
        $lines = explode("\n", trim($this->ndjson()));
        $body = implode("\n\n", $lines)."\n".'{"not":"read"}'."\n";
        Http::fake([self::EVENTS_URL.'*' => Http::response($body)]);

        $events = iterator_to_array($this->gateway()->events(self::RUN_ID), false);

        $this->assertCount(6, $events);
        $this->assertTrue(end($events)->isTerminal());
    }

    public function test_a_resumed_read_starts_after_the_cursor(): void
    {
        $lines = array_slice(explode("\n", trim($this->ndjson())), 4);
        Http::fake([self::EVENTS_URL.'*' => Http::response(implode("\n", $lines)."\n")]);

        $sequences = array_map(fn ($event) => $event->sequence, iterator_to_array($this->gateway()->events(self::RUN_ID, 4), false));

        $this->assertSame([5, 6], $sequences);
        Http::assertSent(fn (Request $request): bool => str_ends_with($request->url(), '?after=4'));
    }

    #[DataProvider('contractViolations')]
    public function test_malformed_or_out_of_order_events_are_contract_violations(?int $badLine, string $raw): void
    {
        $lines = explode("\n", trim($this->ndjson()));
        Http::fake([self::EVENTS_URL.'*' => Http::response($lines[0]."\n".($badLine === null ? $raw : $lines[$badLine])."\n")]);

        $this->assertSame('invalid_response', $this->failure()->reason);
    }

    /** @return array<string, array{int|null, string}> */
    public static function contractViolations(): array
    {
        return [
            'not JSON' => [null, 'not json'],
            'skipped sequence' => [2, ''],
        ];
    }

    public function test_a_stream_that_ends_before_the_terminal_event_is_resumable(): void
    {
        $lines = array_slice(explode("\n", trim($this->ndjson())), 0, 3);
        Http::fake([self::EVENTS_URL.'*' => Http::response(implode("\n", $lines)."\n")]);

        $exception = $this->failure();

        $this->assertSame('stream_interrupted', $exception->reason);
        $this->assertTrue($exception->isRetryable());
    }

    public function test_engine_errors_and_bad_arguments_are_reported(): void
    {
        Http::fake([self::EVENTS_URL.'*' => Http::response(['error' => ['code' => 'run_not_found', 'message' => 'Unknown.']], 404)]);
        $this->assertSame('run_not_found', $this->failure()->reason);

        $this->expectException(InvalidArgumentException::class);
        iterator_to_array($this->gateway()->events('../health'));
    }

    private function failure(): AgentGatewayException
    {
        try {
            iterator_to_array($this->gateway()->events(self::RUN_ID), false);
        } catch (AgentGatewayException $exception) {
            return $exception;
        }

        $this->fail('Reading the events unexpectedly succeeded.');
    }

    private function gateway(): AgentGateway
    {
        return app(AgentGateway::class);
    }

    private function ndjson(): string
    {
        $events = json_decode((string) file_get_contents(base_path('contracts/v1/examples/run-events.json')), true, flags: JSON_THROW_ON_ERROR);

        return implode("\n", array_map(fn (array $event): string => json_encode($event, JSON_THROW_ON_ERROR), $events))."\n";
    }
}
