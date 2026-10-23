<?php

namespace Tests\Feature\Settings;

use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionTestResult;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Fakes\FakeConnectionGateway;
use Tests\TestCase;

class ConnectionsTest extends TestCase
{
    use RefreshDatabase;

    private const REDIRECT = 'http://127.0.0.1:1455/auth/callback?code=one-time&state=fake-state';

    private FakeConnectionGateway $engine;

    protected function setUp(): void
    {
        parent::setUp();

        config(['app.name' => 'Assistant Foundation <Dev>', 'assistant.connection_test_model' => 'gpt-5.4-mini']);
        $this->engine = new FakeConnectionGateway;
        $this->app->instance(ConnectionGateway::class, $this->engine);
    }

    public function test_guests_and_unverified_users_cannot_open_connections(): void
    {
        $this->get('/settings/connections')->assertRedirect(route('login'));
        $this->post('/settings/connections/chatgpt/login')->assertRedirect(route('login'));

        $this->actingAs(User::factory()->unverified()->create())
            ->get('/settings/connections')->assertRedirect(route('verification.notice'));

        $this->assertSame([], $this->engine->calls);
    }

    public function test_the_page_shows_a_not_connected_subscription_and_creates_the_record(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get('/settings/connections')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('settings/connections')
                ->where('defaultTestModel', 'gpt-5.4-mini')
                ->where('chatgpt', [
                    'engine' => 'available',
                    'status' => 'not_connected',
                    'expires_at' => null,
                    'models' => ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'],
                    'login' => null,
                ]));

        $connection = $user->providerConnections()->sole();
        $this->assertSame(['openai', 'oauth', 'not_configured', null], [
            $connection->provider, $connection->auth_method, $connection->status, $connection->credential_reference,
        ]);
        $this->assertSame([['connectionStatus', $connection->id], ['loginState', $connection->id]], $this->engine->calls);

        // Revisiting reuses the record.
        $this->get('/settings/connections')->assertOk();
        $this->assertSame(1, $user->providerConnections()->count());
    }

    public function test_an_unconfigured_or_unreachable_engine_is_reported_without_failing_the_page(): void
    {
        $user = User::factory()->create();
        $this->engine->failures['connectionStatus'] = AgentGatewayException::rejected(503, 'credential_store_not_configured', 'No key.');

        $this->actingAs($user)->get('/settings/connections')->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('chatgpt.engine', 'not_configured')->where('chatgpt.status', null));

        $this->engine->failures['connectionStatus'] = AgentGatewayException::unavailable(null);
        $this->get('/settings/connections')->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('chatgpt.engine', 'unavailable'));
    }

    public function test_signing_in_by_pasting_the_redirect_connects_the_subscription(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->post('/settings/connections/chatgpt/login')->assertRedirect(route('connections.edit'));
        $connection = $user->providerConnections()->sole();
        $this->assertContains(['startLogin', $connection->id, 'Assistant Foundation Dev'], $this->engine->calls);

        $this->get('/settings/connections')->assertInertia(fn (Assert $page) => $page
            ->where('chatgpt.login.state', 'waiting_for_user')
            ->where('chatgpt.login.auth_url', FakeConnectionGateway::AUTH_URL));

        $this->post('/settings/connections/chatgpt/login/callback', ['redirect_url' => '  '.self::REDIRECT.' '])
            ->assertRedirect(route('connections.edit'))
            ->assertSessionHasNoErrors();
        $this->assertContains(['completeLogin', $connection->id, self::REDIRECT], $this->engine->calls);

        $connection->refresh();
        $this->assertSame(['connected', "engine:$connection->id"], [$connection->status, $connection->credential_reference]);
        $this->get('/settings/connections')->assertInertia(fn (Assert $page) => $page
            ->where('chatgpt.status', 'connected')
            ->where('chatgpt.login.state', 'connected')
            ->whereType('chatgpt.expires_at', 'string'));
    }

    public function test_a_browser_completed_sign_in_is_mirrored_when_the_page_polls(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->post('/settings/connections/chatgpt/login');
        $this->engine->connect();

        $this->get('/settings/connections')->assertInertia(fn (Assert $page) => $page->where('chatgpt.login.state', 'connected'));

        $this->assertSame('connected', $user->providerConnections()->sole()->status);
    }

    public function test_engine_refusals_return_to_the_page_as_errors(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->engine->failures['completeLogin'] = AgentGatewayException::rejected(422, 'invalid_redirect', 'This address belongs to a different sign-in.');
        $this->post('/settings/connections/chatgpt/login/callback', ['redirect_url' => self::REDIRECT])
            ->assertRedirect(route('connections.edit'))
            ->assertSessionHasErrors(['redirect_url' => 'This address belongs to a different sign-in.']);

        $this->engine->failures['startLogin'] = AgentGatewayException::rejected(409, 'login_in_progress', 'Another sign-in is in progress.');
        $this->post('/settings/connections/chatgpt/login')
            ->assertSessionHasErrors(['connection' => 'Another account is signing in right now. Try again in a few minutes.']);

        $this->engine->failures['startLogin'] = AgentGatewayException::unavailable(null);
        $this->post('/settings/connections/chatgpt/login')
            ->assertSessionHasErrors(['connection' => 'The assistant engine is not reachable right now. Try again in a moment.']);

        $this->post('/settings/connections/chatgpt/login/callback', ['redirect_url' => ''])
            ->assertSessionHasErrors('redirect_url');
        // The address carries a one-time code, so a refused one is not kept as old input.
        $this->post('/settings/connections/chatgpt/login/callback', ['redirect_url' => self::REDIRECT.str_repeat('x', 4096)])
            ->assertSessionHasErrors('redirect_url');
        $this->assertNull(session()->getOldInput('redirect_url'));
        $this->assertSame('not_configured', $user->providerConnections()->sole()->status);
    }

    public function test_cancelling_shows_the_outcome_only_within_the_sign_in_window(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->post('/settings/connections/chatgpt/login');
        $this->delete('/settings/connections/chatgpt/login')->assertRedirect(route('connections.edit'));

        $this->get('/settings/connections')->assertInertia(fn (Assert $page) => $page
            ->where('chatgpt.login.state', 'cancelled')
            ->where('chatgpt.login.error', 'The sign-in was cancelled.'));

        $this->travel(11)->minutes();
        $this->get('/settings/connections')->assertInertia(fn (Assert $page) => $page->where('chatgpt.login', null));
    }

    public function test_a_test_message_reports_its_result_once(): void
    {
        $user = User::factory()->create();
        $this->engine->connect();
        $this->actingAs($user);

        $this->post('/settings/connections/chatgpt/test', ['model_id' => 'gpt-5.4'])
            ->assertRedirect(route('connections.edit'))
            ->assertInertiaFlash('connectionTest', [
                'model_id' => 'gpt-5.4', 'ok' => true, 'latency_ms' => 1840, 'reply' => 'Connected', 'error_code' => null, 'error' => null,
            ]);

        $this->post('/settings/connections/chatgpt/test', ['model_id' => 'not a model'])->assertSessionHasErrors('model_id');
        $this->assertSame(['testConnection'], array_values(array_filter($this->engine->methods(), fn (string $method): bool => $method === 'testConnection')));
    }

    public function test_an_expired_sign_in_found_by_a_test_marks_the_record_for_reauthentication(): void
    {
        $user = User::factory()->create();
        $this->engine->connect();
        $this->actingAs($user)->get('/settings/connections');
        $connection = $user->providerConnections()->sole();
        $this->assertSame('connected', $connection->status);

        $this->engine->testResult = new ConnectionTestResult($connection->id, 'openai', 'gpt-5.4-mini', false, 210, null, 'reauth_required', 'The sign-in has expired or was revoked. Sign in again.');
        $this->post('/settings/connections/chatgpt/test', ['model_id' => 'gpt-5.4-mini'])
            ->assertInertiaFlash('connectionTest.error_code', 'reauth_required');

        $this->assertSame('reauth_required', $connection->refresh()->status);
    }

    public function test_disconnecting_removes_the_engine_sign_in_and_resets_the_record(): void
    {
        $user = User::factory()->create();
        $this->engine->connect();
        $this->actingAs($user)->get('/settings/connections');

        $this->delete('/settings/connections/chatgpt')
            ->assertRedirect(route('connections.edit'))
            ->assertInertiaFlash('toast', ['type' => 'success', 'message' => 'ChatGPT disconnected.']);

        $connection = $user->providerConnections()->sole();
        $this->assertSame(['not_configured', null], [$connection->status, $connection->credential_reference]);
        $this->assertSame('not_connected', $this->engine->status);
    }

    public function test_each_user_signs_in_with_their_own_connection(): void
    {
        $first = User::factory()->create();
        $second = User::factory()->create();
        $theirs = ProviderConnection::query()->forceCreate([
            'user_id' => $first->id, 'provider' => 'openai', 'auth_method' => 'oauth', 'status' => 'not_configured',
        ]);

        $this->actingAs($second)->post('/settings/connections/chatgpt/login');

        $mine = $second->providerConnections()->sole();
        $this->assertNotSame($theirs->id, $mine->id);
        $this->assertSame([$mine->id], array_values(array_unique(array_map(fn (array $call): string => $call[1], $this->engine->calls))));
    }
}
