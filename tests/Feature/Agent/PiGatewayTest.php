<?php

namespace Tests\Feature\Agent;

use App\Contracts\AgentGateway;
use App\Data\Agent\RunRequest;
use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\PiGateway;
use App\Services\Ai\ServiceRequestSigner;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PiGatewayTest extends TestCase
{
    private const KEY = 'test-request-signing-key-0123456789abcdef';

    private const RUNS_URL = 'http://agent.test:3101/internal/runs';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'assistant.agent_url' => 'http://agent.test:3101',
            'assistant.agent_request_signing_key' => self::KEY,
        ]);
    }

    public function test_the_contract_resolves_to_the_pi_gateway(): void
    {
        $this->assertInstanceOf(PiGateway::class, app(AgentGateway::class));
    }

    public function test_submit_sends_the_exact_signed_contract_payload(): void
    {
        $this->freezeTime();
        $example = $this->example();
        Http::fake([self::RUNS_URL => Http::response($this->acknowledgement($example['runId']), 202)]);

        $acknowledgement = app(AgentGateway::class)->submit($this->request($example));

        $this->assertSame([$example['runId'], 'accepted', false], [$acknowledgement->runId, $acknowledgement->status, $acknowledgement->duplicate]);
        Http::assertSentCount(1);
        Http::assertSent(function (Request $request) use ($example): bool {
            $timestamp = (string) now()->getTimestamp();
            $expected = (new ServiceRequestSigner(self::KEY))->signature($timestamp, 'POST', '/internal/runs', $request->body());

            return $request->method() === 'POST'
                && $request->url() === self::RUNS_URL
                && $request->header('Content-Type') === ['application/json']
                && json_decode($request->body(), true) === $example
                && $request->header('X-Agent-Timestamp') === [$timestamp]
                && $request->header('X-Agent-Signature') === [$expected];
        });
    }

    public function test_an_idempotent_resubmission_is_reported_as_a_duplicate(): void
    {
        $example = $this->example();
        Http::fake([self::RUNS_URL => Http::response($this->acknowledgement($example['runId'], duplicate: true), 202)]);

        $this->assertTrue(app(AgentGateway::class)->submit($this->request($example))->duplicate);
    }

    /** @param  array<string, mixed>  $body */
    #[DataProvider('engineRejections')]
    public function test_engine_error_codes_are_surfaced_with_details(int $status, array $body, string $reason, bool $retryable): void
    {
        Http::fake([self::RUNS_URL => Http::response($body, $status)]);

        $exception = $this->submitExpectingFailure();

        $this->assertSame($reason, $exception->reason);
        $this->assertSame($status, $exception->status);
        $this->assertSame($retryable, $exception->isRetryable());
        $this->assertSame($body['error']['details'] ?? [], $exception->details);
    }

    /** @return array<string, array{int, array<string, mixed>, string, bool}> */
    public static function engineRejections(): array
    {
        $error = fn (string $code, array $details = []): array => ['error' => ['code' => $code, 'message' => 'Rejected.', ...($details === [] ? [] : ['details' => $details])]];

        return [
            'invalid signature' => [401, $error('authentication_failed'), 'authentication_failed', false],
            'invalid payload' => [422, $error('invalid_payload', [['path' => '/messages/0/role', 'message' => 'must be equal to one of the allowed values']]), 'invalid_payload', false],
            'mismatched contract version' => [422, $error('unsupported_contract_version', [['path' => '/contractVersion', 'message' => 'must be 1']]), 'unsupported_contract_version', false],
            'conflicting duplicate' => [409, $error('conflicting_duplicate'), 'conflicting_duplicate', false],
            'unverified model' => [422, $error('model_unavailable'), 'model_unavailable', false],
            'engine signing key missing' => [503, $error('request_auth_not_configured'), 'request_auth_not_configured', false],
            'engine at capacity' => [503, $error('capacity_exhausted'), 'capacity_exhausted', true],
        ];
    }

    /** @param  array<string, mixed>|string  $body */
    #[DataProvider('contractViolations')]
    public function test_responses_outside_the_contract_are_rejected(int $status, array|string $body): void
    {
        Http::fake([self::RUNS_URL => Http::response($body, $status)]);

        $this->assertSame('invalid_response', $this->submitExpectingFailure()->reason);
    }

    /** @return array<string, array{int, array<string, mixed>|string}> */
    public static function contractViolations(): array
    {
        $runId = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e';
        $ack = ['contractVersion' => 1, 'runId' => $runId, 'status' => 'accepted', 'duplicate' => false];

        return [
            'newer contract version' => [202, [...$ack, 'contractVersion' => 2]],
            'another run ID' => [202, [...$ack, 'runId' => '0199f2a0-7c1e-7a3b-9d4e-000000000000']],
            'unknown status' => [202, [...$ack, 'status' => 'completed']],
            'string duplicate flag' => [202, [...$ack, 'duplicate' => 'false']],
            'extra field' => [202, [...$ack, 'answer' => 'Early text']],
            'success without 202' => [200, $ack],
            'client error without envelope' => [400, 'Bad request'],
        ];
    }

    public function test_transport_failures_are_unavailable_and_retryable(): void
    {
        Http::fake(fn () => throw new ConnectionException('Connection refused'));
        $refused = $this->submitExpectingFailure();
        $this->assertSame('unavailable', $refused->reason);
        $this->assertTrue($refused->isRetryable());
        $this->assertInstanceOf(ConnectionException::class, $refused->getPrevious());
    }

    public function test_a_bare_gateway_error_is_treated_as_unavailable(): void
    {
        Http::fake([self::RUNS_URL => Http::response('<html>Bad gateway</html>', 502)]);

        $exception = $this->submitExpectingFailure();

        $this->assertSame(['unavailable', 502], [$exception->reason, $exception->status]);
    }

    public function test_a_missing_or_short_signing_key_fails_closed_without_sending(): void
    {
        Http::fake();

        foreach ([null, '', str_repeat('k', ServiceRequestSigner::MIN_KEY_LENGTH - 1)] as $key) {
            config(['assistant.agent_request_signing_key' => $key]);
            $this->assertSame('not_configured', $this->submitExpectingFailure()->reason);
        }

        Http::assertNothingSent();
    }

    public function test_cancel_signs_its_own_path_and_requires_a_cancellation_acknowledgement(): void
    {
        $runId = $this->example()['runId'];
        $url = self::RUNS_URL."/$runId/cancel";
        Http::fake([$url => Http::response([...$this->acknowledgement($runId), 'status' => 'cancel_requested'], 202)]);

        $this->assertSame('cancel_requested', app(AgentGateway::class)->cancel($runId)->status);
        Http::assertSent(function (Request $request) use ($runId, $url): bool {
            $signature = (new ServiceRequestSigner(self::KEY))
                ->signature($request->header('X-Agent-Timestamp')[0], 'POST', "/internal/runs/$runId/cancel", $request->body());

            return $request->url() === $url
                && json_decode($request->body(), true) === ['contractVersion' => 1, 'runId' => $runId]
                && $request->header('X-Agent-Signature') === [$signature];
        });
    }

    public function test_cancel_rejects_malformed_run_ids_before_sending(): void
    {
        Http::fake();

        try {
            app(AgentGateway::class)->cancel('../health');
            $this->fail('A malformed run ID was accepted.');
        } catch (InvalidArgumentException) {
            Http::assertNothingSent();
        }
    }

    public function test_health_reports_readiness_without_signing(): void
    {
        Http::fake(['http://agent.test:3101/internal/health' => Http::response([
            'status' => 'ok', 'service' => 'agent', 'providerAuth' => 'not_configured', 'requestAuth' => 'configured', 'simulation' => 'enabled',
        ])]);

        $this->assertSame(
            ['status' => 'ok', 'providerAuth' => 'not_configured', 'requestAuth' => 'configured', 'simulation' => 'enabled'],
            app(AgentGateway::class)->health(),
        );
        Http::assertSent(fn (Request $request): bool => ! $request->hasHeader('X-Agent-Signature'));
    }

    private function submitExpectingFailure(): AgentGatewayException
    {
        try {
            app(AgentGateway::class)->submit($this->request($this->example()));
        } catch (AgentGatewayException $exception) {
            return $exception;
        }

        $this->fail('The engine call unexpectedly succeeded.');
    }

    /** @return array<string, mixed> */
    private function acknowledgement(string $runId, bool $duplicate = false): array
    {
        return ['contractVersion' => 1, 'runId' => $runId, 'status' => 'accepted', 'duplicate' => $duplicate];
    }

    /** @return array<string, mixed> */
    private function example(): array
    {
        return json_decode((string) file_get_contents(base_path('contracts/v1/examples/run-request.json')), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @param  array<string, mixed>  $contract */
    private function request(array $contract): RunRequest
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
