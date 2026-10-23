<?php

namespace Tests\Feature\Agent;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CheckAgentConnectionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'assistant.agent_url' => 'http://agent.test:3101',
            'assistant.agent_request_signing_key' => str_repeat('k', 40),
        ]);
    }

    public function test_it_passes_when_signed_requests_reach_validation_and_unsigned_ones_are_refused(): void
    {
        $this->fakeEngine(signedStatus: 422, signedCode: 'invalid_payload');

        $this->artisan('agent:check')
            ->expectsOutputToContain('No run was started')
            ->assertSuccessful();

        Http::assertSentCount(3);
    }

    public function test_it_fails_when_the_engine_rejects_this_applications_signature(): void
    {
        $this->fakeEngine(signedStatus: 401, signedCode: 'authentication_failed');

        $this->artisan('agent:check')
            ->expectsOutputToContain('authentication_failed')
            ->assertFailed();
    }

    public function test_it_fails_when_the_engine_has_no_signing_key(): void
    {
        $this->fakeEngine(signedStatus: 503, signedCode: 'request_auth_not_configured');

        $this->artisan('agent:check')
            ->expectsOutputToContain('request_auth_not_configured')
            ->assertFailed();
    }

    public function test_it_fails_when_unsigned_requests_are_not_rejected(): void
    {
        $this->fakeEngine(signedStatus: 422, signedCode: 'invalid_payload', unsignedStatus: 422);

        $this->artisan('agent:check')
            ->expectsOutputToContain('an unsigned request was not rejected')
            ->assertFailed();
    }

    public function test_it_fails_when_the_engine_is_unreachable(): void
    {
        Http::fake(fn () => throw new ConnectionException('Connection refused'));

        $this->artisan('agent:check')
            ->expectsOutputToContain('unavailable')
            ->assertFailed();
    }

    private function fakeEngine(int $signedStatus, string $signedCode, int $unsignedStatus = 401): void
    {
        Http::fake(function (Request $request) use ($signedStatus, $signedCode, $unsignedStatus) {
            if (str_ends_with($request->url(), '/internal/health')) {
                return Http::response(['status' => 'ok', 'providerAuth' => 'not_configured', 'requestAuth' => 'configured', 'simulation' => 'enabled']);
            }

            return $request->hasHeader('X-Agent-Signature')
                ? Http::response(['error' => ['code' => $signedCode, 'message' => 'Probe result.']], $signedStatus)
                : Http::response(['error' => ['code' => 'authentication_failed', 'message' => 'Unsigned.']], $unsignedStatus);
        });
    }
}
