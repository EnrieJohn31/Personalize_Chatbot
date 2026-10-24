<?php

namespace App\Services\Connections;

use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\ConnectionTestResult;
use App\Data\Agent\LocalModelStatus;
use App\Data\Agent\LoginState;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use Illuminate\Container\Attributes\Config;
use SensitiveParameter;

/**
 * A user's provider connections (Build Plan task 3.1): ChatGPT through OpenAI's own "Sign in with
 * ChatGPT", OpenCode Go and Zen through a key the user enters, and the administrator's local model
 * server, which needs no credential of the user's. The engine holds every credential. Laravel keeps
 * one connection record per provider with a mirrored, non-secret status, which decides whether a
 * run may use the connection, plus the user's choice of connection and model for chat.
 */
final class ProviderConnections
{
    /** Record statuses; only `connected` may back a live model (RunRequestFactory). */
    public const CONNECTED = 'connected';

    public const NOT_CONFIGURED = 'not_configured';

    public const REAUTH_REQUIRED = 'reauth_required';

    /** The local model server is configured but did not answer. */
    public const UNREACHABLE = 'unreachable';

    /** What the engine's login contract accepts as the name on the consent screen. */
    private const AGENT_NAME_PATTERN = '/\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}\z/';

    /**
     * @param  array<string, array{name: string, auth: string, test_model: string}>  $providers
     */
    public function __construct(
        private readonly ConnectionGateway $gateway,
        #[Config('app.name')] private readonly string $applicationName,
        #[Config('assistant.connection_providers')] private readonly array $providers,
    ) {}

    /** @return array<string, array{name: string, auth: string, test_model: string}> */
    public function providers(): array
    {
        return $this->providers;
    }

    public function authMethod(string $provider): ?string
    {
        return $this->providers[$provider]['auth'] ?? null;
    }

    /** The user's existing connection to a provider; the oldest wins if the connection API made several. */
    public function find(User $user, string $provider): ?ProviderConnection
    {
        return $user->providerConnections()
            ->where('provider', $provider)
            ->where('auth_method', $this->authMethod($provider))
            ->orderBy('created_at')
            ->orderBy('id')
            ->first();
    }

    /** The user's connection to a provider, created on first use. It holds no secret. */
    public function connectionFor(User $user, string $provider): ProviderConnection
    {
        return $this->find($user, $provider)
            ?? $user->providerConnections()->create(['provider' => $provider, 'auth_method' => $this->authMethod($provider)]);
    }

    /** @throws AgentGatewayException */
    public function status(ProviderConnection $connection): ConnectionStatus
    {
        return $this->mirror($connection, $this->gateway->connectionStatus($connection->id, $connection->provider));
    }

    /**
     * The administrator's local model server; its address is engine configuration only.
     *
     * @throws AgentGatewayException
     */
    public function localModel(): LocalModelStatus
    {
        return $this->gateway->localModel();
    }

    /**
     * Brings the user's local-server record, if any, in line with what the server just answered,
     * so a chat blocked while it was down works again once the Connections page sees it answer.
     */
    public function mirrorLocal(User $user, string $provider, LocalModelStatus $local): void
    {
        $connection = $this->find($user, $provider);

        if ($connection !== null) {
            $this->record($connection, match (true) {
                ! $local->configured => self::NOT_CONFIGURED,
                $local->reachable => self::CONNECTED,
                default => self::UNREACHABLE,
            });
        }
    }

    /** @throws AgentGatewayException */
    public function startLogin(ProviderConnection $connection): LoginState
    {
        return $this->gateway->startLogin($connection->id, $connection->provider, $this->agentName());
    }

    /**
     * The connection's latest sign-in, or null when the engine holds none for it.
     *
     * @throws AgentGatewayException
     */
    public function loginState(ProviderConnection $connection): ?LoginState
    {
        try {
            $login = $this->gateway->loginState($connection->id, $connection->provider);
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
        return $this->settle($connection, $this->gateway->completeLogin($connection->id, $connection->provider, $redirectUrl));
    }

    /** @throws AgentGatewayException */
    public function cancelLogin(ProviderConnection $connection): LoginState
    {
        return $this->settle($connection, $this->gateway->cancelLogin($connection->id, $connection->provider));
    }

    /** @throws AgentGatewayException */
    public function saveKey(ProviderConnection $connection, #[SensitiveParameter] string $apiKey): ConnectionStatus
    {
        return $this->mirror($connection, $this->gateway->saveKey($connection->id, $connection->provider, $apiKey));
    }

    /**
     * Removes the engine-held credential. Chat stops using the connection.
     *
     * @throws AgentGatewayException
     */
    public function disconnect(User $user, ProviderConnection $connection): ConnectionStatus
    {
        $status = $this->gateway->disconnect($connection->id, $connection->provider);
        if ($status->status !== 'not_connected') {
            throw AgentGatewayException::invalidResponse(200, 'disconnect did not confirm credential removal.');
        }
        $this->mirror($connection, $status);

        if ($user->chat_connection_id === $connection->id) {
            $this->useForChat($user, null, null);
        }

        return $status;
    }

    /**
     * Clear engine credentials before account deletion removes their connection IDs. Include
     * duplicate records and unfinished sign-ins; their mirrored status may still be unconfigured.
     * A failed step leaves the account intact, and repeating completed disconnects is safe.
     *
     * @throws AgentGatewayException
     */
    public function disconnectAll(User $user): void
    {
        // The shared local model server holds nothing of the user's, so there is nothing to remove.
        $withCredentials = array_keys(array_filter($this->providers, fn (array $provider): bool => $provider['auth'] !== 'none'));

        foreach ($user->providerConnections()->whereIn('provider', $withCredentials)->cursor() as $connection) {
            $this->disconnect($user, $connection);
        }
    }

    /**
     * Sends one test message, which counts against the user's plan or balance.
     *
     * @throws AgentGatewayException
     */
    public function test(ProviderConnection $connection, string $modelId): ConnectionTestResult
    {
        $result = $this->gateway->testConnection($connection->id, $connection->provider, $modelId);

        if ($result->ok) {
            // A working reply proves the sign-in works, including after an earlier rejection.
            $this->record($connection, self::CONNECTED);
        } elseif ($result->errorCode !== null) {
            $this->recordFailure($connection, $result->errorCode);
        }

        return $result;
    }

    /** Records what a failed test message or chat reply revealed about the connection's sign-in. */
    public function recordFailure(ProviderConnection $connection, string $code): void
    {
        match ($code) {
            'reauth_required', 'credentials_unreadable' => $this->record($connection, self::REAUTH_REQUIRED),
            'not_connected' => $this->record($connection, self::NOT_CONFIGURED),
            default => null,
        };
    }

    /** Chooses the connection and model chat replies use; null for both returns to the built-in default. */
    public function useForChat(User $user, ?ProviderConnection $connection, ?string $modelId): void
    {
        $user->forceFill(['chat_connection_id' => $connection?->id, 'chat_model' => $connection === null ? null : $modelId])->save();
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

    private function mirror(ProviderConnection $connection, ConnectionStatus $status): ConnectionStatus
    {
        $this->record($connection, match ($status->status) {
            'connected' => self::CONNECTED,
            'unreadable', 'reauth_required' => self::REAUTH_REQUIRED,
            'unreachable' => self::UNREACHABLE,
            default => self::NOT_CONFIGURED,
        });

        return $status;
    }

    private function record(ProviderConnection $connection, string $status): void
    {
        $holdsCredential = $status !== self::NOT_CONFIGURED && $this->authMethod($connection->provider) !== 'none';

        $connection->forceFill([
            'status' => $status,
            // Names where the credential lives; it is never the credential itself.
            'credential_reference' => $holdsCredential ? "engine:{$connection->id}" : null,
        ]);

        if ($connection->isDirty()) {
            $connection->save();
        }
    }
}
