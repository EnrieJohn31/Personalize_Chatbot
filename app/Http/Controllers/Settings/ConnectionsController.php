<?php

namespace App\Http\Controllers\Settings;

use App\Data\Agent\LoginState;
use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\CompleteSignInRequest;
use App\Http\Requests\Settings\TestConnectionRequest;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use App\Services\Connections\SubscriptionConnections;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Container\Attributes\Config;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Settings > Connections: connect a ChatGPT subscription through the engine's sign-in. Every action
 * redirects back to the page, whose `chatgpt` prop is read from the engine on each visit, so the
 * page polls by reloading that prop while a sign-in is in progress.
 */
class ConnectionsController extends Controller
{
    public function __construct(
        private readonly SubscriptionConnections $connections,
        #[Config('assistant.connection_test_model')] private readonly string $defaultTestModel,
    ) {}

    public function edit(Request $request): Response
    {
        $connection = $this->connection($request);

        return Inertia::render('settings/connections', [
            'chatgpt' => fn (): array => $this->overview($connection),
            'defaultTestModel' => $this->defaultTestModel,
        ]);
    }

    public function startLogin(Request $request): RedirectResponse
    {
        return $this->attempt(fn () => $this->connections->startLogin($this->connection($request)));
    }

    public function completeLogin(CompleteSignInRequest $request): RedirectResponse
    {
        $redirectUrl = $request->string('redirect_url')->trim()->toString();

        return $this->attempt(fn () => $this->connections->completeLogin($this->connection($request), $redirectUrl));
    }

    public function cancelLogin(Request $request): RedirectResponse
    {
        return $this->attempt(fn () => $this->connections->cancelLogin($this->connection($request)));
    }

    public function test(TestConnectionRequest $request): RedirectResponse
    {
        $modelId = $request->string('model_id')->toString();

        return $this->attempt(function () use ($request, $modelId): void {
            $result = $this->connections->test($this->connection($request), $modelId);

            Inertia::flash('connectionTest', [
                'model_id' => $result->modelId,
                'ok' => $result->ok,
                'latency_ms' => $result->latencyMs,
                'reply' => $result->reply,
                'error_code' => $result->errorCode,
                'error' => $result->errorMessage,
            ]);
        });
    }

    public function disconnect(Request $request): RedirectResponse
    {
        return $this->attempt(function () use ($request): void {
            $this->connections->disconnect($this->connection($request));

            Inertia::flash('toast', ['type' => 'success', 'message' => __('ChatGPT disconnected.')]);
        });
    }

    private function connection(Request $request): ProviderConnection
    {
        /** @var User $user */
        $user = $request->user();

        return $this->connections->connectionFor($user);
    }

    /**
     * Engine answers for the page. A failed sign-in stays visible until its sign-in window ends.
     *
     * @return array<string, mixed>
     */
    private function overview(ProviderConnection $connection): array
    {
        try {
            $status = $this->connections->status($connection);
            $login = $this->connections->loginState($connection);
        } catch (AgentGatewayException $exception) {
            Log::warning('Connection status unavailable', ['reason' => $exception->reason]);

            return [
                'engine' => in_array($exception->reason, ['not_configured', 'credential_store_not_configured'], true) ? 'not_configured' : 'unavailable',
                'status' => null,
                'expires_at' => null,
                'models' => [],
                'login' => null,
            ];
        }

        $models = $status->models;
        sort($models, SORT_NATURAL);
        $recent = $login !== null && ($login->isActive() || $login->expiresAt > now()->getTimestampMs());

        return [
            'engine' => 'available',
            'status' => $status->status,
            'expires_at' => $this->time($status->expiresAt),
            'models' => $models,
            'login' => $recent ? $this->login($login) : null,
        ];
    }

    /** @return array<string, string|null> */
    private function login(LoginState $login): array
    {
        return [
            'state' => $login->state,
            'auth_url' => $login->authUrl,
            'error' => $login->error,
            'expires_at' => $this->time($login->expiresAt),
        ];
    }

    private function time(?int $milliseconds): ?string
    {
        return $milliseconds === null ? null : CarbonImmutable::createFromTimestampMsUTC($milliseconds)->toIso8601ZuluString();
    }

    /** Runs one engine step; a refusal returns to the page as a form error instead of failing the request. */
    private function attempt(Closure $step): RedirectResponse
    {
        try {
            $step();
        } catch (AgentGatewayException $exception) {
            Log::warning('Connection step failed', ['reason' => $exception->reason]);
            $field = $exception->reason === 'invalid_redirect' ? 'redirect_url' : 'connection';

            return to_route('connections.edit')->withErrors([$field => $this->message($exception)]);
        }

        return to_route('connections.edit');
    }

    private function message(AgentGatewayException $exception): string
    {
        return match ($exception->reason) {
            'not_configured', 'credential_store_not_configured' => __('ChatGPT sign-in is not set up on this server. Set AGENT_CREDENTIAL_KEY and restart the engine.'),
            'unavailable' => __('The assistant engine is not reachable right now. Try again in a moment.'),
            'login_in_progress' => __('Another account is signing in right now. Try again in a few minutes.'),
            'login_not_waiting', 'no_login' => __('This sign-in has already ended. Start again if ChatGPT is not connected.'),
            'invalid_redirect' => $exception->engineMessage ?? __('That address does not belong to this sign-in.'),
            'unknown_model' => __('That model is not available for testing.'),
            default => __('The assistant engine could not complete this step. Try again.'),
        };
    }
}
