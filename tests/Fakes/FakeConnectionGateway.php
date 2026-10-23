<?php

namespace Tests\Fakes;

use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\ConnectionTestResult;
use App\Data\Agent\LoginState;
use App\Services\Ai\AgentGatewayException;

/** Engine sign-in state for controller tests: one connection's status and latest sign-in, in memory. */
final class FakeConnectionGateway implements ConnectionGateway
{
    public const AUTH_URL = 'https://auth.openai.com/api/accounts/authorize?state=fake-state';

    /** @var list<array{0: string, 1: string, 2?: string}> method, connection ID and the call's argument */
    public array $calls = [];

    public string $status = 'not_connected';

    public ?int $expiresAt = null;

    /** @var list<string> */
    public array $models = ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4'];

    /** State of the latest sign-in; null when the engine holds none. */
    public ?string $loginState = null;

    public ?string $loginError = null;

    public int $loginExpiresAt = 0;

    public ?ConnectionTestResult $testResult = null;

    /** @var array<string, AgentGatewayException> thrown by the named method instead of answering */
    public array $failures = [];

    public function connectionStatus(string $connectionId, string $provider): ConnectionStatus
    {
        $this->call(__FUNCTION__, $connectionId);

        return new ConnectionStatus($connectionId, $provider, $this->status, $this->expiresAt, $this->models);
    }

    public function startLogin(string $connectionId, string $provider, string $agentName): LoginState
    {
        $this->call(__FUNCTION__, $connectionId, $agentName);
        $this->loginState = 'waiting_for_user';
        $this->loginError = null;
        $this->loginExpiresAt = now()->addMinutes(10)->getTimestampMs();

        return $this->login($connectionId, $provider);
    }

    public function loginState(string $connectionId, string $provider): LoginState
    {
        $this->call(__FUNCTION__, $connectionId);

        return $this->login($connectionId, $provider);
    }

    public function completeLogin(string $connectionId, string $provider, string $redirectUrl): LoginState
    {
        $this->call(__FUNCTION__, $connectionId, $redirectUrl);
        $this->connect();

        return $this->login($connectionId, $provider);
    }

    public function cancelLogin(string $connectionId, string $provider): LoginState
    {
        $this->call(__FUNCTION__, $connectionId);
        $this->loginState = 'cancelled';
        $this->loginError = 'The sign-in was cancelled.';

        return $this->login($connectionId, $provider);
    }

    public function disconnect(string $connectionId, string $provider): ConnectionStatus
    {
        $this->call(__FUNCTION__, $connectionId);
        $this->status = 'not_connected';
        $this->expiresAt = null;

        return $this->connectionStatus($connectionId, $provider);
    }

    public function testConnection(string $connectionId, string $provider, string $modelId): ConnectionTestResult
    {
        $this->call(__FUNCTION__, $connectionId, $modelId);

        return $this->testResult ?? new ConnectionTestResult($connectionId, $provider, $modelId, true, 1840, 'Connected', null, null);
    }

    /** What the engine holds after a sign-in finished, through the browser or a pasted address. */
    public function connect(): void
    {
        $this->loginState = 'connected';
        $this->loginError = null;
        $this->status = 'connected';
        $this->expiresAt = now()->addHour()->getTimestampMs();
    }

    /** @return list<string> */
    public function methods(): array
    {
        return array_map(fn (array $call): string => $call[0], $this->calls);
    }

    private function call(string $method, string $connectionId, ?string $argument = null): void
    {
        $this->calls[] = $argument === null ? [$method, $connectionId] : [$method, $connectionId, $argument];

        if (isset($this->failures[$method])) {
            throw $this->failures[$method];
        }
    }

    private function login(string $connectionId, string $provider): LoginState
    {
        if ($this->loginState === null) {
            throw AgentGatewayException::rejected(404, 'no_login', 'No sign-in is in progress for this connection.');
        }

        $authUrl = $this->loginState === 'waiting_for_user' ? self::AUTH_URL : null;

        return new LoginState($connectionId, $provider, $this->loginState, $authUrl, $this->loginError, $this->loginExpiresAt);
    }
}
