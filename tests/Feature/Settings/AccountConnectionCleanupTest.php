<?php

namespace Tests\Feature\Settings;

use App\Contracts\ConnectionGateway;
use App\Data\Agent\ConnectionStatus;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Fakes\FakeConnectionGateway;
use Tests\TestCase;

class AccountConnectionCleanupTest extends TestCase
{
    use RefreshDatabase;

    public function test_account_deletion_disconnects_every_owned_supported_connection(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $gateway = new FakeConnectionGateway;
        $this->app->instance(ConnectionGateway::class, $gateway);
        $expectedCalls = [];

        // Include duplicate provider records and an unfinished first sign-in with no mirrored status.
        foreach (['openai', 'opencode', 'opencode-go', 'openai'] as $provider) {
            $connection = $user->providerConnections()->create([
                'provider' => $provider,
                'auth_method' => $provider === 'openai' ? 'oauth' : 'api_key',
            ]);
            $expectedCalls[] = ['disconnect', $connection->id, $provider];
        }
        $foreign = $other->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $user->providerConnections()->create(['provider' => 'metadata-only', 'auth_method' => 'api_key']);
        // The shared local model server holds nothing of the user's; only its record goes.
        $user->providerConnections()->create(['provider' => 'local', 'auth_method' => 'none']);

        $this->actingAs($user)->delete(route('profile.destroy'), ['password' => 'password'])
            ->assertSessionHasNoErrors()->assertRedirect(route('home'));

        $this->assertEqualsCanonicalizing($expectedCalls, $gateway->calls);
        $this->assertGuest();
        $this->assertNull($user->fresh());
        $this->assertDatabaseMissing('provider_connections', ['user_id' => $user->id]);
        $this->assertModelExists($foreign);
    }

    public function test_cleanup_failure_preserves_the_account_and_allows_retry(): void
    {
        $user = User::factory()->create();
        $connection = $user->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $gateway = new FakeConnectionGateway;
        $gateway->failures['disconnect'] = AgentGatewayException::unavailable(null);
        $this->app->instance(ConnectionGateway::class, $gateway);

        $this->actingAs($user)->from(route('profile.edit'))
            ->delete(route('profile.destroy'), ['password' => 'password'])
            ->assertSessionHasErrors('password')->assertRedirect(route('profile.edit'));

        $this->assertAuthenticatedAs($user);
        $this->assertModelExists($user);
        $this->assertModelExists($connection);

        unset($gateway->failures['disconnect']);
        $this->delete(route('profile.destroy'), ['password' => 'password'])
            ->assertSessionHasNoErrors()->assertRedirect(route('home'));

        $this->assertCount(2, $gateway->calls);
        $this->assertGuest();
        $this->assertNull($user->fresh());
    }

    public function test_an_engine_that_still_reports_connected_cannot_confirm_account_deletion(): void
    {
        $user = User::factory()->create();
        $connection = $user->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $this->mock(ConnectionGateway::class)->shouldReceive('disconnect')->once()
            ->with($connection->id, 'openai')
            ->andReturn(new ConnectionStatus($connection->id, 'openai', 'connected', null, []));

        $this->actingAs($user)->from(route('profile.edit'))
            ->delete(route('profile.destroy'), ['password' => 'password'])
            ->assertSessionHasErrors('password')->assertRedirect(route('profile.edit'));

        $this->assertAuthenticatedAs($user);
        $this->assertModelExists($user);
        $this->assertModelExists($connection);
    }

    public function test_wrong_password_never_disconnects_provider_credentials(): void
    {
        $user = User::factory()->create();
        $connection = $user->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $gateway = new FakeConnectionGateway;
        $this->app->instance(ConnectionGateway::class, $gateway);

        $this->actingAs($user)->from(route('profile.edit'))
            ->delete(route('profile.destroy'), ['password' => 'wrong-password'])
            ->assertSessionHasErrors('password')->assertRedirect(route('profile.edit'));

        $this->assertSame([], $gateway->calls);
        $this->assertAuthenticatedAs($user);
        $this->assertModelExists($connection);
    }
}
