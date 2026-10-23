<?php

namespace Tests\Feature\Agent;

use App\Contracts\ConnectionGateway;
use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\PiGateway;
use App\Services\Ai\ServiceRequestSigner;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Tests\TestCase;

class PiGatewayConnectionsTest extends TestCase
{
    private const KEY = 'test-request-signing-key-0123456789abcdef';

    private const CONNECTION_ID = '0199f2a1-3d4e-7f50-8162-738495a6b7c8';

    private const BASE = 'http://agent.test:3101/internal/connections/'.self::CONNECTION_ID;

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
        $this->assertInstanceOf(PiGateway::class, app(ConnectionGateway::class));
    }

    public function test_status_and_disconnect_sign_the_path_with_its_provider_query(): void
    {
        Http::fake([self::BASE.'?provider=openai' => Http::response($this->example('connection-status.json'))]);

        $this->assertTrue($this->gateway()->connectionStatus(self::CONNECTION_ID, 'openai')->isConnected());
        $this->assertSame('connected', $this->gateway()->disconnect(self::CONNECTION_ID, 'openai')->status);

        $this->assertSignedRequests([
            ['GET', '/internal/connections/'.self::CONNECTION_ID.'?provider=openai', ''],
            ['DELETE', '/internal/connections/'.self::CONNECTION_ID.'?provider=openai', ''],
        ]);
    }

    public function test_sign_in_steps_send_their_contract_bodies(): void
    {
        $login = $this->example('connection-login.json');
        Http::fake([
            self::BASE.'/login/callback' => Http::response([...$login, 'state' => 'connected', 'authUrl' => null]),
            self::BASE.'/login' => Http::response($login),
        ]);
        $redirect = 'http://127.0.0.1:1455/auth/callback?code=one-time&state=example-state';

        $this->assertSame('waiting_for_user', $this->gateway()->startLogin(self::CONNECTION_ID, 'openai', 'Assistant Foundation')->state);
        $this->assertSame('waiting_for_user', $this->gateway()->loginState(self::CONNECTION_ID, 'openai')->state);
        $this->assertSame('connected', $this->gateway()->completeLogin(self::CONNECTION_ID, 'openai', $redirect)->state);
        $this->assertSame('waiting_for_user', $this->gateway()->cancelLogin(self::CONNECTION_ID, 'openai')->state);

        $path = '/internal/connections/'.self::CONNECTION_ID;
        $this->assertSignedRequests([
            ['POST', "$path/login", '{"contractVersion":1,"provider":"openai","agentName":"Assistant Foundation"}'],
            ['GET', "$path/login", ''],
            ['POST', "$path/login/callback", '{"contractVersion":1,"redirectUrl":"'.$redirect.'"}'],
            ['DELETE', "$path/login", ''],
        ]);
    }

    public function test_saving_a_key_sends_it_once_in_a_signed_put(): void
    {
        $status = [...$this->example('connection-status.json'), 'provider' => 'opencode-go', 'expiresAt' => null];
        Http::fake([self::BASE.'/key' => Http::response($status)]);

        $saved = $this->gateway()->saveKey(self::CONNECTION_ID, 'opencode-go', 'oc-key-0123456789');

        $this->assertSame(['opencode-go', 'connected', null], [$saved->provider, $saved->status, $saved->expiresAt]);
        $this->assertSignedRequests([
            ['PUT', '/internal/connections/'.self::CONNECTION_ID.'/key', '{"contractVersion":1,"provider":"opencode-go","apiKey":"oc-key-0123456789"}'],
        ]);
    }

    public function test_a_connection_test_reports_the_engine_result(): void
    {
        Http::fake([self::BASE.'/test' => Http::response($this->example('connection-test-result.json'))]);

        $result = $this->gateway()->testConnection(self::CONNECTION_ID, 'openai', 'gpt-5.4-mini');

        $this->assertSame([true, 'Connected', 1840], [$result->ok, $result->reply, $result->latencyMs]);
        $this->assertSignedRequests([
            ['POST', '/internal/connections/'.self::CONNECTION_ID.'/test', '{"contractVersion":1,"provider":"openai","modelId":"gpt-5.4-mini"}'],
        ]);
    }

    public function test_engine_refusals_keep_their_code_and_own_message(): void
    {
        Http::fake([self::BASE.'/login/callback' => Http::response(['error' => [
            'code' => 'invalid_redirect',
            'message' => 'This address belongs to a different sign-in. Use the address from the latest sign-in tab.',
        ]], 422)]);

        $exception = $this->failure(fn () => $this->gateway()->completeLogin(self::CONNECTION_ID, 'openai', 'http://127.0.0.1:1455/auth/callback'));

        $this->assertSame(['invalid_redirect', 422], [$exception->reason, $exception->status]);
        $this->assertSame('This address belongs to a different sign-in. Use the address from the latest sign-in tab.', $exception->engineMessage);
        $this->assertFalse($exception->isRetryable());
    }

    public function test_answers_outside_the_contract_are_invalid_responses(): void
    {
        Http::fake([
            self::BASE.'?provider=openai' => Http::response([...$this->example('connection-status.json'), 'access' => 'token']),
            self::BASE.'/login' => Http::response([...$this->example('connection-login.json'), 'connectionId' => '0199f2a1-3d4e-7f50-8162-000000000000']),
            self::BASE.'/test' => Http::response($this->example('connection-test-result.json'), 202),
        ]);

        $this->assertSame('invalid_response', $this->failure(fn () => $this->gateway()->connectionStatus(self::CONNECTION_ID, 'openai'))->reason);
        $this->assertSame('invalid_response', $this->failure(fn () => $this->gateway()->loginState(self::CONNECTION_ID, 'openai'))->reason);
        $this->assertSame('invalid_response', $this->failure(fn () => $this->gateway()->testConnection(self::CONNECTION_ID, 'openai', 'gpt-5.4-mini'))->reason);
    }

    public function test_malformed_connection_ids_and_missing_keys_send_nothing(): void
    {
        Http::fake();

        try {
            $this->gateway()->connectionStatus('../runs', 'openai');
            $this->fail('A malformed connection ID was accepted.');
        } catch (InvalidArgumentException) {
        }

        config(['assistant.agent_request_signing_key' => null]);
        $this->assertSame('not_configured', $this->failure(fn () => $this->gateway()->startLogin(self::CONNECTION_ID, 'openai', 'App'))->reason);
        Http::assertNothingSent();
    }

    private function gateway(): ConnectionGateway
    {
        return app(ConnectionGateway::class);
    }

    /** @param  list<array{string, string, string}>  $expected  method, signed target and exact body */
    private function assertSignedRequests(array $expected): void
    {
        $recorded = Http::recorded()->map(fn (array $pair): Request => $pair[0])->values();
        $this->assertCount(count($expected), $recorded);

        foreach ($expected as $index => [$method, $target, $body]) {
            $request = $recorded[$index];
            $signature = (new ServiceRequestSigner(self::KEY))->signature($request->header('X-Agent-Timestamp')[0], $method, $target, $request->body());

            $this->assertSame($method, $request->method());
            $this->assertSame("http://agent.test:3101$target", $request->url());
            $this->assertSame($body, $request->body());
            $this->assertSame([$signature], $request->header('X-Agent-Signature'));
        }
    }

    /** @param  callable(): mixed  $call */
    private function failure(callable $call): AgentGatewayException
    {
        try {
            $call();
        } catch (AgentGatewayException $exception) {
            return $exception;
        }

        $this->fail('The engine call unexpectedly succeeded.');
    }

    /** @return array<string, mixed> */
    private function example(string $file): array
    {
        return json_decode((string) file_get_contents(base_path("contracts/v1/examples/$file")), true, flags: JSON_THROW_ON_ERROR);
    }
}
