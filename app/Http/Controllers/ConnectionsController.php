<?php

namespace App\Http\Controllers;

use App\Contracts\AgentGateway;
use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\LoginState;
use App\Http\Requests\Connections\CompleteSignInRequest;
use App\Http\Requests\Connections\SaveConnectionKeyRequest;
use App\Http\Requests\Connections\TestConnectionRequest;
use App\Http\Requests\Connections\UseForChatRequest;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use App\Services\Connections\ProviderConnections;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The Connections page: connect ChatGPT through its browser sign-in and OpenCode Go or Zen with an
 * API key, test them, and choose which connection chat uses. Every action redirects back to the
 * page, whose `connections` prop is read from the engine on each visit, so the page polls by
 * reloading that prop while a sign-in is in progress.
 */
class ConnectionsController extends Controller
{
    public function __construct(
        private readonly ProviderConnections $connections,
        private readonly AgentGateway $engine,
    ) {}

    public function index(Request $request): Response
    {
        $user = $this->user($request);

        return Inertia::render('connections/index', [
            'connections' => fn (): array => $this->overview($user),
        ]);
    }

    public function startLogin(Request $request, string $provider): RedirectResponse
    {
        $this->requireAuth($provider, 'oauth');

        return $this->attempt(fn () => $this->connections->startLogin($this->connection($request, $provider)));
    }

    public function completeLogin(CompleteSignInRequest $request, string $provider): RedirectResponse
    {
        $this->requireAuth($provider, 'oauth');
        $redirectUrl = $request->string('redirect_url')->trim()->toString();

        return $this->attempt(fn () => $this->connections->completeLogin($this->connection($request, $provider), $redirectUrl));
    }

    public function cancelLogin(Request $request, string $provider): RedirectResponse
    {
        $this->requireAuth($provider, 'oauth');

        return $this->attempt(fn () => $this->connections->cancelLogin($this->connection($request, $provider)));
    }

    public function saveKey(SaveConnectionKeyRequest $request, string $provider): RedirectResponse
    {
        $this->requireAuth($provider, 'api_key');
        $apiKey = $request->string('api_key')->toString();

        return $this->attempt(function () use ($request, $provider, $apiKey): void {
            $this->connections->saveKey($this->connection($request, $provider), $apiKey);

            Inertia::flash('toast', ['type' => 'success', 'message' => __(':name connected.', ['name' => $this->name($provider)])]);
        });
    }

    public function test(TestConnectionRequest $request, string $provider): RedirectResponse
    {
        $modelId = $request->string('model_id')->toString();

        return $this->attempt(function () use ($request, $provider, $modelId): void {
            $result = $this->connections->test($this->connection($request, $provider), $modelId);

            Inertia::flash('connectionTest', [
                'provider' => $provider,
                'model_id' => $result->modelId,
                'ok' => $result->ok,
                'latency_ms' => $result->latencyMs,
                'reply' => $result->reply,
                'error_code' => $result->errorCode,
                'error' => $result->errorMessage,
            ]);
        });
    }

    public function disconnect(Request $request, string $provider): RedirectResponse
    {
        return $this->attempt(function () use ($request, $provider): void {
            $this->connections->disconnect($this->user($request), $this->connection($request, $provider));

            Inertia::flash('toast', ['type' => 'success', 'message' => __(':name disconnected.', ['name' => $this->name($provider)])]);
        });
    }

    /** Chooses the connection and model chat uses, checked against the engine's current status. */
    public function useForChat(UseForChatRequest $request): RedirectResponse
    {
        $user = $this->user($request);
        $provider = $request->string('provider')->toString();

        if ($provider === '') {
            $this->connections->useForChat($user, null, null);
            Inertia::flash('toast', ['type' => 'success', 'message' => __('Chat uses the built-in assistant.')]);

            return to_route('connections.index');
        }

        $modelId = $request->string('model_id')->toString();
        $connection = $this->connections->find($user, $provider);

        return $this->attempt(function () use ($user, $provider, $modelId, $connection): ?RedirectResponse {
            $status = $connection === null ? null : $this->connections->status($connection);

            if ($connection === null || $status === null || ! $status->isConnected()) {
                return to_route('connections.index')->withErrors(['chat' => __('Connect :name first.', ['name' => $this->name($provider)])]);
            }
            if (! in_array($modelId, $status->models, true)) {
                return to_route('connections.index')->withErrors(['model_id' => __(':name does not offer that model.', ['name' => $this->name($provider)])]);
            }

            $this->connections->useForChat($user, $connection, $modelId);
            Inertia::flash('toast', ['type' => 'success', 'message' => __('Chat will use :name with :model.', ['name' => $this->name($provider), 'model' => $modelId])]);

            return null;
        });
    }

    /**
     * Engine answers for the page. A finished sign-in's outcome stays visible until its sign-in
     * window ends.
     *
     * @return array<string, mixed>
     */
    private function overview(User $user): array
    {
        try {
            $health = $this->engine->health();
            if ($health['providerAuth'] !== 'configured') {
                return $this->unavailable($user, 'not_configured');
            }

            $providers = [];
            foreach ($this->connections->providers() as $provider => $definition) {
                $connection = $this->connections->find($user, $provider);
                $status = $connection === null ? null : $this->connections->status($connection);
                $login = $connection !== null && $definition['auth'] === 'oauth' ? $this->connections->loginState($connection) : null;
                $providers[] = $this->card($provider, $definition, $status, $login);
            }
        } catch (AgentGatewayException $exception) {
            Log::warning('Connection status unavailable', ['reason' => $exception->reason]);

            return $this->unavailable($user, in_array($exception->reason, ['not_configured', 'credential_store_not_configured'], true) ? 'not_configured' : 'unavailable');
        }

        return ['engine' => 'available', 'providers' => $providers, 'chat' => $this->chat($user, $providers)];
    }

    /** @return array<string, mixed> */
    private function unavailable(User $user, string $engine): array
    {
        $providers = [];
        foreach ($this->connections->providers() as $provider => $definition) {
            $providers[] = [...$this->card($provider, $definition, null, null), 'status' => null];
        }

        return ['engine' => $engine, 'providers' => $providers, 'chat' => $this->chat($user, $providers)];
    }

    /**
     * @param  array{name: string, auth: string, test_model: string}  $definition
     * @return array<string, mixed>
     */
    private function card(string $provider, array $definition, ?ConnectionStatus $status, ?LoginState $login): array
    {
        $models = $status !== null && $status->isConnected() ? $status->models : [];
        sort($models, SORT_NATURAL);
        $recent = $login !== null && ($login->isActive() || $login->expiresAt > now()->getTimestampMs());

        return [
            'provider' => $provider,
            'name' => $definition['name'],
            'auth' => $definition['auth'],
            'status' => $status->status ?? 'not_connected',
            'expires_at' => $this->time($status?->expiresAt),
            'models' => $models,
            'test_model' => $definition['test_model'],
            'login' => $recent ? [
                'state' => $login->state,
                'auth_url' => $login->authUrl,
                'error' => $login->error,
                'expires_at' => $this->time($login->expiresAt),
            ] : null,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $providers
     * @return array{provider: string, name: string, model: string, connected: bool}|null
     */
    private function chat(User $user, array $providers): ?array
    {
        $connection = $user->chatConnection;
        if ($connection === null || $user->chat_model === null) {
            return null;
        }

        $card = collect($providers)->firstWhere('provider', $connection->provider);

        return [
            'provider' => $connection->provider,
            'name' => $this->name($connection->provider),
            'model' => $user->chat_model,
            'connected' => is_array($card) && $card['status'] === 'connected',
        ];
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }

    private function connection(Request $request, string $provider): ProviderConnection
    {
        return $this->connections->connectionFor($this->user($request), $provider);
    }

    private function name(string $provider): string
    {
        return $this->connections->providers()[$provider]['name'] ?? $provider;
    }

    private function requireAuth(string $provider, string $method): void
    {
        abort_unless($this->connections->authMethod($provider) === $method, 404);
    }

    private function time(?int $milliseconds): ?string
    {
        return $milliseconds === null ? null : CarbonImmutable::createFromTimestampMsUTC($milliseconds)->toIso8601ZuluString();
    }

    /**
     * Runs one engine step; a refusal returns to the page as a form error instead of failing the
     * request. A step may return its own redirect.
     */
    private function attempt(Closure $step): RedirectResponse
    {
        try {
            $redirect = $step();
        } catch (AgentGatewayException $exception) {
            Log::warning('Connection step failed', ['reason' => $exception->reason]);
            $field = $exception->reason === 'invalid_redirect' ? 'redirect_url' : 'connection';

            return to_route('connections.index')->withErrors([$field => $this->message($exception)]);
        }

        return $redirect instanceof RedirectResponse ? $redirect : to_route('connections.index');
    }

    private function message(AgentGatewayException $exception): string
    {
        return match ($exception->reason) {
            'not_configured', 'credential_store_not_configured' => __('Connections are not set up on this server. Set AGENT_CREDENTIAL_KEY and restart the engine.'),
            'unavailable' => __('The assistant engine is not reachable right now. Try again in a moment.'),
            'login_in_progress' => __('Another account is signing in right now. Try again in a few minutes.'),
            'login_not_waiting', 'no_login' => __('This sign-in has already ended. Start again if ChatGPT is not connected.'),
            'invalid_redirect' => $exception->engineMessage ?? __('That address does not belong to this sign-in.'),
            'unknown_model' => __('That model is not available for testing.'),
            default => __('The assistant engine could not complete this step. Try again.'),
        };
    }
}
