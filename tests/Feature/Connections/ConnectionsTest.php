<?php

namespace Tests\Feature\Connections;

use App\Contracts\AgentGateway;
use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionTestResult;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Fakes\FakeAgentGateway;
use Tests\Fakes\FakeConnectionGateway;
use Tests\TestCase;

class ConnectionsTest extends TestCase
{
    use RefreshDatabase;

    private const REDIRECT = 'http://127.0.0.1:1455/auth/callback?code=one-time&state=fake-state';

    private const KEY = 'oc-test-key-0123456789abcdef';

    private FakeConnectionGateway $engine;

    private FakeAgentGateway $agent;

    protected function setUp(): void
    {
        parent::setUp();

        config(['app.name' => 'Assistant Foundation <Dev>', 'assistant.connection_providers.openai.test_model' => 'gpt-5.4-mini']);
        $this->engine = new FakeConnectionGateway;
        $this->agent = new FakeAgentGateway;
        $this->agent->providerAuth = 'configured';
        $this->app->instance(ConnectionGateway::class, $this->engine);
        $this->app->instance(AgentGateway::class, $this->agent);
    }

    public function test_guests_and_unverified_users_cannot_open_connections(): void
    {
        $this->get('/connections')->assertRedirect(route('login'));
        $this->post('/connections/openai/login')->assertRedirect(route('login'));
        $this->put('/connections/opencode-go/key', ['api_key' => self::KEY])->assertRedirect(route('login'));

        $this->actingAs(User::factory()->unverified()->create())
            ->get('/connections')->assertRedirect(route('verification.notice'));

        $this->assertSame([], $this->engine->calls);
    }

    public function test_the_old_settings_address_redirects_to_the_connections_page(): void
    {
        $this->actingAs(User::factory()->create())
            ->get('/settings/connections')->assertStatus(301)->assertRedirect('/connections');
    }

    public function test_a_new_user_sees_four_unconnected_providers_without_records_being_created(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get('/connections')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('connections/index')
                ->where('connections.engine', 'available')
                ->where('connections.chat', null)
                ->has('connections.providers', 4)
                ->where('connections.providers.0', [
                    'provider' => 'openai',
                    'name' => 'ChatGPT',
                    'auth' => 'oauth',
                    'status' => 'not_connected',
                    'expires_at' => null,
                    'rejection' => null,
                    'models' => [],
                    'test_model' => 'gpt-5.4-mini',
                    'login' => null,
                    'local' => null,
                ])
                ->where('connections.providers.1.provider', 'opencode-go')
                ->where('connections.providers.1.auth', 'api_key')
                ->where('connections.providers.2.provider', 'opencode')
                ->where('connections.providers.2.name', 'OpenCode Zen')
                ->where('connections.providers.2.test_model', 'beam-free')
                ->where('connections.providers.3', [
                    'provider' => 'local',
                    'name' => 'Local model',
                    'auth' => 'none',
                    'status' => 'not_connected',
                    'expires_at' => null,
                    'rejection' => null,
                    'models' => [],
                    'test_model' => '',
                    'login' => null,
                    'local' => ['configured' => false, 'base_url' => null, 'error' => null],
                ]));

        $this->assertSame(0, $user->providerConnections()->count());
        // Only the shared local server is asked about; the user has no connection records yet.
        $this->assertSame([['localModel', 'server']], $this->engine->calls);
    }

    public function test_the_local_model_server_is_listed_tested_and_chosen_for_chat_without_a_key(): void
    {
        $user = User::factory()->create();
        $this->engine->serveLocally(['qwen2.5:7b', 'llama3.2:latest']);
        $this->actingAs($user);

        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.3.name', 'Ollama on this PC')
            ->where('connections.providers.3.status', 'connected')
            ->where('connections.providers.3.models', ['llama3.2:latest', 'qwen2.5:7b'])
            ->where('connections.providers.3.test_model', 'llama3.2:latest')
            ->where('connections.providers.3.local', ['configured' => true, 'base_url' => 'http://host.docker.internal:11434/v1', 'error' => null]));
        $this->assertSame(0, $user->providerConnections()->count());

        $this->post('/connections/local/test', ['model_id' => 'qwen2.5:7b'])
            ->assertInertiaFlash('connectionTest.ok', true)
            ->assertInertiaFlash('connectionTest.model_id', 'qwen2.5:7b');

        $this->put('/connections/chat', ['provider' => 'local', 'model_id' => 'mistral:7b'])
            ->assertSessionHasErrors(['model_id' => 'Local model does not offer that model.']);
        $this->put('/connections/chat', ['provider' => 'local', 'model_id' => 'qwen2.5:7b'])
            ->assertSessionHasNoErrors()
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'Chat will use Local model with qwen2.5:7b.']);

        $connection = $user->providerConnections()->sole();
        $this->assertSame(['local', 'none', 'connected', null], [$connection->provider, $connection->auth_method, $connection->status, $connection->credential_reference]);
        $this->assertSame([$connection->id, 'qwen2.5:7b'], [$user->refresh()->chat_connection_id, $user->chat_model]);
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.chat', ['provider' => 'local', 'name' => 'Local model', 'model' => 'qwen2.5:7b', 'connected' => true]));

        // The administrator manages the server, so there is nothing to disconnect or paste.
        $this->delete('/connections/local')->assertNotFound();
        $this->put('/connections/local/key', ['api_key' => self::KEY])->assertNotFound();
        $this->post('/connections/local/login')->assertNotFound();
        $this->assertNotContains('disconnect', $this->engine->methods());
    }

    public function test_a_local_server_that_is_missing_or_down_cannot_be_chosen_and_recovers_on_the_next_visit(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->put('/connections/chat', ['provider' => 'local', 'model_id' => 'llama3.2:latest'])
            ->assertSessionHasErrors(['chat' => 'No local model server is set up.']);

        $this->engine->serveLocally(reachable: false);
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.3.status', 'unreachable')
            ->where('connections.providers.3.models', [])
            ->where('connections.providers.3.local.error', 'Ollama on this PC could not be reached.'));
        $this->put('/connections/chat', ['provider' => 'local', 'model_id' => 'llama3.2:latest'])
            ->assertSessionHasErrors(['chat' => 'Local model is not reachable right now.']);
        $this->assertSame(0, $user->providerConnections()->count());

        $this->engine->serveLocally();
        $this->put('/connections/chat', ['provider' => 'local', 'model_id' => 'llama3.2:latest'])->assertSessionHasNoErrors();
        $connection = $user->providerConnections()->sole();
        $user->refresh();

        // The record follows the server, so chat is blocked only while it is down.
        $this->engine->serveLocally(reachable: false);
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page->where('connections.chat.connected', false));
        $this->assertSame('unreachable', $connection->refresh()->status);

        $this->engine->serveLocally();
        $this->get('/connections');
        $this->assertSame('connected', $connection->refresh()->status);
    }

    public function test_an_unconfigured_or_unreachable_engine_is_reported_without_failing_the_page(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->agent->providerAuth = 'not_configured';
        $this->get('/connections')->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('connections.engine', 'not_configured')->where('connections.providers.0.status', null));

        $this->agent->providerAuth = 'configured';
        $this->agent->healthFailure = AgentGatewayException::unavailable(null);
        $this->get('/connections')->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('connections.engine', 'unavailable'));

        $this->agent->healthFailure = null;
        $this->post('/connections/openai/login');
        $this->engine->failures['connectionStatus'] = AgentGatewayException::rejected(503, 'credential_store_not_configured', 'No key.');
        $this->get('/connections')->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('connections.engine', 'not_configured'));
    }

    public function test_signing_in_to_chatgpt_by_pasting_the_redirect_connects_it(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->post('/connections/openai/login')->assertRedirect(route('connections.index'));
        $connection = $user->providerConnections()->sole();
        $this->assertSame(['openai', 'oauth'], [$connection->provider, $connection->auth_method]);
        $this->assertContains(['startLogin', $connection->id, 'Assistant Foundation Dev'], $this->engine->calls);

        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.0.login.state', 'waiting_for_user')
            ->where('connections.providers.0.login.auth_url', FakeConnectionGateway::AUTH_URL));

        $this->post('/connections/openai/login/callback', ['redirect_url' => '  '.self::REDIRECT.' '])
            ->assertRedirect(route('connections.index'))
            ->assertSessionHasNoErrors();
        $this->assertContains(['completeLogin', $connection->id, self::REDIRECT], $this->engine->calls);

        $connection->refresh();
        $this->assertSame(['connected', "engine:$connection->id"], [$connection->status, $connection->credential_reference]);
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.0.status', 'connected')
            ->where('connections.providers.0.models', ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'])
            ->whereType('connections.providers.0.expires_at', 'string'));
    }

    public function test_a_browser_completed_sign_in_is_mirrored_when_the_page_polls(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->post('/connections/openai/login');
        $this->engine->connect();

        $this->get('/connections')->assertInertia(fn (Assert $page) => $page->where('connections.providers.0.login.state', 'connected'));

        $this->assertSame('connected', $user->providerConnections()->sole()->status);
    }

    public function test_sign_in_refusals_return_to_the_page_as_errors(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->engine->failures['completeLogin'] = AgentGatewayException::rejected(422, 'invalid_redirect', 'This address belongs to a different sign-in.');
        $this->post('/connections/openai/login/callback', ['redirect_url' => self::REDIRECT])
            ->assertRedirect(route('connections.index'))
            ->assertSessionHasErrors(['redirect_url' => 'This address belongs to a different sign-in.']);

        $this->engine->failures['startLogin'] = AgentGatewayException::rejected(409, 'login_in_progress', 'Another sign-in is in progress.');
        $this->post('/connections/openai/login')
            ->assertSessionHasErrors(['connection' => 'Another account is signing in right now. Try again in a few minutes.']);

        $this->engine->failures['startLogin'] = AgentGatewayException::unavailable(null);
        $this->post('/connections/openai/login')
            ->assertSessionHasErrors(['connection' => 'The assistant engine is not reachable right now. Try again in a moment.']);

        // The address carries a one-time code, so a refused one is not kept as old input.
        $this->post('/connections/openai/login/callback', ['redirect_url' => self::REDIRECT.str_repeat('x', 4096)])
            ->assertSessionHasErrors('redirect_url');
        $this->assertNull(session()->getOldInput('redirect_url'));
        $this->assertSame('not_configured', $user->providerConnections()->sole()->status);
    }

    public function test_cancelling_shows_the_outcome_only_within_the_sign_in_window(): void
    {
        $this->actingAs(User::factory()->create())->post('/connections/openai/login');
        $this->delete('/connections/openai/login')->assertRedirect(route('connections.index'));

        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.0.login.state', 'cancelled')
            ->where('connections.providers.0.login.error', 'The sign-in was cancelled.'));

        $this->travel(11)->minutes();
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page->where('connections.providers.0.login', null));
    }

    public function test_an_opencode_key_passes_through_to_the_engine_and_connects_the_provider(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->put('/connections/opencode-go/key', ['api_key' => self::KEY])
            ->assertRedirect(route('connections.index'))
            ->assertSessionHasNoErrors()
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'OpenCode Go connected.']);

        $connection = $user->providerConnections()->sole();
        $this->assertSame(['opencode-go', 'api_key', 'connected'], [$connection->provider, $connection->auth_method, $connection->status]);
        $this->assertSame(['opencode-go' => self::KEY], $this->engine->keys);
        // Laravel keeps no copy: not in the record, the session or the engine call log.
        $this->assertStringNotContainsString(self::KEY, (string) json_encode([$connection->getAttributes(), session()->all(), $this->engine->calls]));

        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.1.status', 'connected')
            ->where('connections.providers.1.models', ['beam-free', 'glm-5.3'])
            ->where('connections.providers.2.status', 'not_connected'));
    }

    public function test_keys_are_validated_and_never_kept_as_old_input(): void
    {
        $this->actingAs(User::factory()->create());

        foreach (['', 'short', 'has spaces in it', str_repeat('k', 513)] as $key) {
            $this->put('/connections/opencode/key', ['api_key' => $key])->assertSessionHasErrors('api_key');
            $this->assertNull(session()->getOldInput('api_key'));
        }

        // Each provider connects its own way.
        $this->put('/connections/openai/key', ['api_key' => self::KEY])->assertNotFound();
        $this->post('/connections/opencode/login')->assertNotFound();
        $this->put('/connections/anthropic/key', ['api_key' => self::KEY])->assertNotFound();
        $this->assertSame([], $this->engine->keys);
    }

    public function test_a_test_message_reports_its_result_once(): void
    {
        $this->engine->connect('opencode');
        $this->actingAs(User::factory()->create());

        $this->post('/connections/opencode/test', ['model_id' => 'beam-free'])
            ->assertRedirect(route('connections.index'))
            ->assertInertiaFlash('connectionTest', [
                'provider' => 'opencode', 'model_id' => 'beam-free', 'ok' => true, 'latency_ms' => 1840, 'reply' => 'Connected', 'error_code' => null, 'error' => null,
            ]);

        $this->post('/connections/opencode/test', ['model_id' => 'not a model'])->assertSessionHasErrors('model_id');
        $this->assertCount(1, array_filter($this->engine->methods(), fn (string $method): bool => $method === 'testConnection'));
    }

    public function test_an_expired_sign_in_found_by_a_test_marks_the_record_for_reauthentication(): void
    {
        $user = User::factory()->create();
        $this->engine->connect();
        $this->actingAs($user)->post('/connections/openai/login');
        $this->get('/connections');
        $connection = $user->providerConnections()->sole();
        $this->assertSame('connected', $connection->status);

        $this->engine->testResult = new ConnectionTestResult($connection->id, 'openai', 'gpt-5.4-mini', false, 210, null, 'reauth_required', 'The sign-in has expired or was revoked. Sign in again.');
        $this->post('/connections/openai/test', ['model_id' => 'gpt-5.4-mini'])
            ->assertInertiaFlash('connectionTest.error_code', 'reauth_required');

        $this->assertSame('reauth_required', $connection->refresh()->status);

        // The engine keeps reporting the rejection, so viewing the page does not undo it, even
        // while the earlier sign-in is still reported as finished. The page shows the provider's reason.
        $this->engine->statuses['openai'] = 'reauth_required';
        $this->engine->rejections['openai'] = [
            'reason' => 'refresh_token_invalidated',
            'message' => 'ChatGPT invalidated this sign-in (refresh_token_invalidated). Sign in again.',
            'at' => 1_793_010_903_000,
        ];
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.providers.0.status', 'reauth_required')
            ->where('connections.providers.0.rejection', [
                'reason' => 'refresh_token_invalidated',
                'message' => 'ChatGPT invalidated this sign-in (refresh_token_invalidated). Sign in again.',
                'at' => '2026-10-26T10:35:03Z',
            ])
            ->where('connections.providers.0.models', []));
        $this->assertSame('reauth_required', $connection->refresh()->status);
        $this->put('/connections/chat', ['provider' => 'openai', 'model_id' => 'gpt-5.4-mini'])
            ->assertSessionHasErrors(['chat' => 'Connect ChatGPT first.']);

        // Signing in again replaces the rejected sign-in.
        $this->post('/connections/openai/login');
        $this->post('/connections/openai/login/callback', ['redirect_url' => self::REDIRECT])->assertSessionHasNoErrors();
        $this->assertSame('connected', $connection->refresh()->status);
    }

    public function test_chat_uses_a_chosen_connected_model_until_it_is_disconnected(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->put('/connections/chat', ['provider' => 'opencode-go', 'model_id' => 'glm-5.3'])
            ->assertSessionHasErrors(['chat' => 'Connect OpenCode Go first.']);

        $this->put('/connections/opencode-go/key', ['api_key' => self::KEY]);
        $this->put('/connections/chat', ['provider' => 'opencode-go', 'model_id' => 'gpt-6-sol'])
            ->assertSessionHasErrors(['model_id' => 'OpenCode Go does not offer that model.']);
        $this->put('/connections/chat', ['provider' => 'opencode-go'])->assertSessionHasErrors('model_id');

        $this->put('/connections/chat', ['provider' => 'opencode-go', 'model_id' => 'glm-5.3'])
            ->assertRedirect(route('connections.index'))
            ->assertSessionHasNoErrors()
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'Chat will use OpenCode Go with glm-5.3.']);

        $connection = $user->providerConnections()->sole();
        $this->assertSame([$connection->id, 'glm-5.3'], [$user->refresh()->chat_connection_id, $user->chat_model]);
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page
            ->where('connections.chat', ['provider' => 'opencode-go', 'name' => 'OpenCode Go', 'model' => 'glm-5.3', 'connected' => true]));

        $this->delete('/connections/opencode-go')
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'OpenCode Go disconnected.']);
        $this->assertSame([null, null], [$user->refresh()->chat_connection_id, $user->chat_model]);
        $this->assertSame(['not_configured', null], [$connection->refresh()->status, $connection->credential_reference]);
    }

    public function test_chat_returns_to_the_built_in_assistant_on_request(): void
    {
        $user = User::factory()->create();
        $this->engine->connect();
        $this->actingAs($user)->post('/connections/openai/login');
        $this->put('/connections/chat', ['provider' => 'openai', 'model_id' => 'gpt-5.4-mini'])->assertSessionHasNoErrors();

        $this->put('/connections/chat', ['provider' => null])
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'Chat uses the built-in assistant.']);

        $this->assertNull($user->refresh()->chat_connection_id);
    }

    public function test_each_user_connects_their_own_providers(): void
    {
        $first = User::factory()->create();
        $second = User::factory()->create();
        $theirs = ProviderConnection::query()->forceCreate([
            'user_id' => $first->id, 'provider' => 'opencode', 'auth_method' => 'api_key', 'status' => 'connected',
        ]);
        $first->forceFill(['chat_connection_id' => $theirs->id, 'chat_model' => 'beam-free'])->save();

        $this->actingAs($second)->put('/connections/opencode/key', ['api_key' => self::KEY]);

        $mine = $second->providerConnections()->sole();
        $this->assertNotSame($theirs->id, $mine->id);
        $this->assertSame([$mine->id], array_values(array_unique(array_map(fn (array $call): string => $call[1], $this->engine->calls))));
        $this->get('/connections')->assertInertia(fn (Assert $page) => $page->where('connections.chat', null));
    }
}
