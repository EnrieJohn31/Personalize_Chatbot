<?php

namespace App\Services\Connections;

use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\ConnectionTestResult;
use App\Data\Agent\LoginState;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use Illuminate\Container\Attributes\Config;
use SensitiveParameter;

/**
 * A user's ChatGPT subscription connection (Build Plan task 3.1). The engine runs OpenAI's own
 * "Sign in with ChatGPT" flow and keeps the tokens encrypted. Laravel keeps the connection record
 * and a mirrored, non-secret status, which decides whether a run may use the connection.
 */
final class SubscriptionConnections
{
    public const PROVIDER = 'openai';

    public const AUTH_METHOD = 'oauth';

    /** Record statuses; only `connected` may back a live model (RunRequestFactory). */
    public const CONNECTED = 'connected';

    public const NOT_CONFIGURED = 'not_configured';

    public const REAUTH_REQUIRED = 'reauth_required';

    /** What the engine's login contract accepts as the name on the consent screen. */
    private const AGENT_NAME_PATTERN = '/\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}\z/';

    public function __construct(
        private readonly ConnectionGateway $gateway,
        #[Config('app.name')] private readonly string $applicationName,
    ) {}

    /**
     * The user's ChatGPT connection, created on first use. The oldest matching record wins when
     * the connection API created several.
     */
    public function connectionFor(User $user): ProviderConnection
    {
        $existing = $user->providerConnections()
            ->where('provider', self::PROVIDER)
            ->where('auth_method', self::AUTH_METHOD)
            ->orderBy('created_at')
            ->orderBy('id')
            ->first();

        return $existing ?? $user->providerConnections()->create(['provider' => self::PROVIDER, 'auth_method' => self::AUTH_METHOD]);
    }

    /** @throws AgentGatewayException */
    public function status(ProviderConnection $connection): ConnectionStatus
    {
        $status = $this->gateway->connectionStatus($connection->id, self::PROVIDER);
        $this->mirror($connection, match ($status->status) {
            'connected' => self::CONNECTED,
            'unreadable' => self::REAUTH_REQUIRED,
            default => self::NOT_CONFIGURED,
        });

        return $status;
    }

    /** @throws AgentGatewayException */
    public function startLogin(ProviderConnection $connection): LoginState
    {
        return $this->gateway->startLogin($connection->id, self::PROVIDER, $this->agentName());
    }

    /**
     * The connection's latest sign-in, or null when the engine holds none for it.
     *
     * @throws AgentGatewayException
     */
    public function loginState(ProviderConnection $connection): ?LoginState
    {
        try {
            $login = $this->gateway->loginState($connection->id, self::PROVIDER);
        } catch (AgentGatewayException $exception) {
            if ($exception->reason === 'no_login') {
                return null;
            }
            throw $exception;
        }

        return $this->settle($connection, $login);
    }

    /** @throws AgentGatewayException */
    public function completeLogin(ProviderConnection $connection, #[SensitiveParameter] string $redirectUrl): LoginState
    {
        return $this->settle($connection, $this->gateway->completeLogin($connection->id, self::PROVIDER, $redirectUrl));
    }

    /** @throws AgentGatewayException */
    public function cancelLogin(ProviderConnection $connection): LoginState
    {
        return $this->settle($connection, $this->gateway->cancelLogin($connection->id, self::PROVIDER));
    }

    /** @throws AgentGatewayException */
    public function disconnect(ProviderConnection $connection): ConnectionStatus
    {
        $status = $this->gateway->disconnect($connection->id, self::PROVIDER);
        $this->mirror($connection, $status->isConnected() ? self::CONNECTED : self::NOT_CONFIGURED);

        return $status;
    }

    /**
     * Sends one test message, which counts against the user's plan.
     *
     * @throws AgentGatewayException
     */
    public function test(ProviderConnection $connection, string $modelId): ConnectionTestResult
    {
        $result = $this->gateway->testConnection($connection->id, self::PROVIDER, $modelId);

        match ($result->errorCode) {
            'reauth_required', 'credentials_unreadable' => $this->mirror($connection, self::REAUTH_REQUIRED),
            'not_connected' => $this->mirror($connection, self::NOT_CONFIGURED),
            default => null,
        };

        return $result;
    }

    /** The application name for the provider's consent screen, reduced to what the engine accepts. */
    public function agentName(): string
    {
        $name = preg_replace('/[^A-Za-z0-9 ._-]+/', ' ', $this->applicationName) ?? '';
        $name = trim(substr(preg_replace('/\s+/', ' ', trim($name)) ?? '', 0, 64));

        return preg_match(self::AGENT_NAME_PATTERN, $name) === 1 ? $name : 'Assistant';
    }

    /** A finished sign-in changes what the engine stores, so the record follows its new status. */
    private function settle(ProviderConnection $connection, LoginState $login): LoginState
    {
        if ($login->state === 'connected') {
            $this->status($connection);
        }

        return $login;
    }

    private function mirror(ProviderConnection $connection, string $status): void
    {
        $connection->forceFill([
            'status' => $status,
            // Names where the credential lives; it is never the credential itself.
            'credential_reference' => $status === self::NOT_CONFIGURED ? null : "engine:{$connection->id}",
        ]);

        if ($connection->isDirty()) {
            $connection->save();
        }
    }
}
