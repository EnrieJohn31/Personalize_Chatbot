<?php

namespace App\Contracts;

use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\ConnectionTestResult;
use App\Data\Agent\LoginState;
use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\PiGateway;
use Illuminate\Container\Attributes\Bind;

/**
 * Provider sign-in through the private engine. The engine runs the provider's own browser
 * sign-in and keeps the resulting tokens encrypted; every answer here is non-secret state.
 * Connection IDs are the IDs of Laravel's provider connection records.
 */
#[Bind(PiGateway::class)]
interface ConnectionGateway
{
    /**
     * The engine-held sign-in of a connection. Never calls the provider.
     *
     * @throws AgentGatewayException
     */
    public function connectionStatus(string $connectionId, string $provider): ConnectionStatus;

    /**
     * Start the provider's browser sign-in. A connection whose sign-in is already pending gets it
     * back; while another connection signs in, the engine refuses with `login_in_progress`.
     *
     * @throws AgentGatewayException
     */
    public function startLogin(string $connectionId, string $provider, string $agentName): LoginState;

    /**
     * The connection's latest sign-in; reason `no_login` when the engine holds none for it.
     *
     * @throws AgentGatewayException
     */
    public function loginState(string $connectionId, string $provider): LoginState;

    /**
     * Hand the browser's final redirect address to the waiting sign-in, for when the provider's
     * redirect cannot reach the engine. A mistyped address is refused with `invalid_redirect`.
     *
     * @throws AgentGatewayException
     */
    public function completeLogin(string $connectionId, string $provider, string $redirectUrl): LoginState;

    /** @throws AgentGatewayException */
    public function cancelLogin(string $connectionId, string $provider): LoginState;

    /**
     * Remove the engine-held sign-in. Access granted at the provider stays until the user revokes it there.
     *
     * @throws AgentGatewayException
     */
    public function disconnect(string $connectionId, string $provider): ConnectionStatus;

    /**
     * Send one short message with the stored sign-in. It counts against the user's plan, so call it
     * only when the user asks. Provider refusals are a failed result, not an exception.
     *
     * @throws AgentGatewayException
     */
    public function testConnection(string $connectionId, string $provider, string $modelId): ConnectionTestResult;
}
