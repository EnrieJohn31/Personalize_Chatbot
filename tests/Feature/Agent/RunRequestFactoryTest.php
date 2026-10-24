<?php

namespace Tests\Feature\Agent;

use App\Contracts\AgentGateway;
use App\Data\Agent\RunRequest;
use App\Models\Conversation;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Chat\ConversationRepository;
use App\Services\Chat\RunNotDispatchable;
use App\Services\Chat\RunRequestFactory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class RunRequestFactoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_history_becomes_a_server_owned_snapshot(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello', 'assistant:Hi there.', 'A follow-up question']);

        $snapshot = $this->factory()->forConversation($owner, $conversation)->toArray();

        $this->assertMatchesRegularExpression(RunRequest::UUID_PATTERN, $snapshot['runId']);
        $this->assertSame($conversation->id, $snapshot['conversationId']);
        $this->assertSame((string) $owner->id, $snapshot['userId']);
        $this->assertSame(['id' => 'default', 'version' => 2], $snapshot['profile']);
        $this->assertSame(['provider' => 'simulated', 'id' => 'simulated-echo'], $snapshot['model']);
        // The profile's permitted tools, from server configuration; the browser never chooses them.
        $this->assertSame(['lookup_reference'], $snapshot['capabilities']);
        $this->assertSame(['maxModelRounds' => 4, 'maxToolCalls' => 6, 'runDeadlineMs' => 180_000], $snapshot['limits']);
        $this->assertSame(
            [['user', 'Hello'], ['assistant', 'Hi there.'], ['user', 'A follow-up question']],
            array_map(fn (array $message): array => [$message['role'], $message['content']], $snapshot['messages']),
        );
        $this->assertNotSame($snapshot['runId'], $this->factory()->forConversation($owner, $conversation)->runId);
    }

    public function test_history_is_bounded_to_the_latest_messages(): void
    {
        config(['assistant.limits.history_messages' => 2]);
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['First', 'assistant:Second', 'Third']);

        $messages = $this->factory()->forConversation($owner, $conversation)->messages;

        $this->assertSame(['Second', 'Third'], array_column($messages, 'content'));
    }

    public function test_another_users_conversation_is_refused_as_not_found(): void
    {
        $conversation = $this->conversation(User::factory()->create(), ['Private question']);

        try {
            $this->factory()->forConversation(User::factory()->create(), $conversation);
            $this->fail('Another user built a snapshot from private history.');
        } catch (AuthorizationException $exception) {
            $this->assertSame(404, $exception->status());
        }
    }

    public function test_a_forged_cross_user_connection_reference_is_refused(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello']);
        $foreign = $this->connection(User::factory()->create());
        // Application validation prevents this association; simulate a corrupted row.
        DB::table('conversations')->where('id', $conversation->id)->update(['provider_connection_id' => $foreign->id]);

        $this->expectException(AuthorizationException::class);

        $this->factory()->forConversation($owner, $conversation->refresh());
    }

    public function test_simulated_runs_never_forward_connection_metadata(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello']);
        $connection = $this->connection($owner);
        DB::table('provider_connections')->where('id', $connection->id)->update(['credential_reference' => 'private-credential-ref']);
        $conversation->update(['provider_connection_id' => $connection->id]);

        $request = $this->factory()->forConversation($owner, $conversation->refresh());

        $this->assertNull($request->connectionId);
        $this->assertStringNotContainsString('private-credential-ref', $request->toJson());
    }

    public function test_live_models_require_an_owned_matching_ready_connection(): void
    {
        config(['assistant.profile.model' => ['provider' => 'openai', 'id' => 'example-model']]);
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello']);

        $this->assertNotDispatchable('connection_required', $owner, $conversation);

        $other = $this->connection($owner, 'another-provider');
        $conversation->update(['provider_connection_id' => $other->id]);
        $this->assertNotDispatchable('connection_required', $owner, $conversation->refresh());

        $connection = $this->connection($owner, 'openai');
        $conversation->update(['provider_connection_id' => $connection->id]);
        $this->assertNotDispatchable('connection_not_ready', $owner, $conversation->refresh());

        // Only task 3.1's verified login may set this state; forced here to prove the reference is passed.
        DB::table('provider_connections')->where('id', $connection->id)->update(['status' => RunRequestFactory::READY_CONNECTION_STATUS]);
        $this->assertSame($connection->id, $this->factory()->forConversation($owner, $conversation->refresh())->connectionId);
    }

    public function test_a_conversation_uses_the_model_it_started_with_unless_live_replies_are_off(): void
    {
        config(['assistant.live_replies' => false]);
        $owner = User::factory()->create();
        $connection = $this->connection($owner, 'local');
        DB::table('provider_connections')->where('id', $connection->id)->update(['status' => RunRequestFactory::READY_CONNECTION_STATUS]);
        $conversation = $this->conversation($owner, ['Hello']);
        DB::table('conversations')->where('id', $conversation->id)->update([
            'provider_connection_id' => $connection->id, 'model_provider' => 'local', 'model' => 'qwen2.5:7b',
        ]);
        $conversation->refresh();

        // With live replies switched off, every conversation uses the default profile.
        $this->assertSame(['provider' => 'simulated', 'id' => 'simulated-echo'], $this->factory()->forConversation($owner, $conversation)->toArray()['model']);

        config(['assistant.live_replies' => true, 'assistant.reasoning' => 'high']);
        $request = $this->factory()->forConversation($owner, $conversation);
        $this->assertSame(['provider' => 'local', 'id' => 'qwen2.5:7b', 'reasoning' => 'high'], $request->toArray()['model']);
        $this->assertSame($connection->id, $request->connectionId);

        // A conversation without a model uses the default, which needs no connection or reasoning.
        $default = $this->factory()->forConversation($owner, $this->conversation($owner, ['Hi']));
        $this->assertSame(['provider' => 'simulated', 'id' => 'simulated-echo'], $default->toArray()['model']);

        DB::table('provider_connections')->where('id', $connection->id)->update(['status' => 'unreachable']);
        $this->assertNotDispatchable('connection_not_ready', $owner, $conversation->refresh());
    }

    public function test_a_run_needs_a_pending_user_message(): void
    {
        $owner = User::factory()->create();

        $this->assertNotDispatchable('no_pending_user_message', $owner, $this->conversation($owner, []));
        $this->assertNotDispatchable('no_pending_user_message', $owner, $this->conversation($owner, ['Hello', 'assistant:Answered.']));
    }

    public function test_an_owned_snapshot_crosses_the_gateway_without_private_fields(): void
    {
        config(['assistant.agent_url' => 'http://agent.test:3101', 'assistant.agent_request_signing_key' => str_repeat('k', 40)]);
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello']);
        $request = $this->factory()->forConversation($owner, $conversation);
        Http::fake(['http://agent.test:3101/internal/runs' => Http::response([
            'contractVersion' => 1, 'runId' => $request->runId, 'status' => 'accepted', 'duplicate' => false,
        ], 202)]);

        $this->assertSame('accepted', app(AgentGateway::class)->submit($request)->status);
        Http::assertSent(function (Request $sent) use ($request): bool {
            $body = $sent->body();

            return $body === $request->toJson()
                && ! str_contains($body, 'canonical')
                && ! str_contains($body, 'credential')
                && ! str_contains($body, 'email');
        });
    }

    private function assertNotDispatchable(string $reason, User $user, Conversation $conversation): void
    {
        try {
            $this->factory()->forConversation($user, $conversation);
            $this->fail("Expected [$reason].");
        } catch (RunNotDispatchable $exception) {
            $this->assertSame($reason, $exception->reason);
        }
    }

    private function factory(): RunRequestFactory
    {
        return app(RunRequestFactory::class);
    }

    /** @param  list<string>  $messages  prefix "assistant:" stores an assistant message */
    private function conversation(User $owner, array $messages): Conversation
    {
        $conversation = $owner->conversations()->create(['title' => 'Sample conversation']);
        foreach ($messages as $content) {
            if (str_starts_with($content, 'assistant:')) {
                $conversation->messages()->create([
                    'sequence' => ((int) $conversation->messages()->max('sequence')) + 1,
                    'role' => 'assistant',
                    'content' => substr($content, strlen('assistant:')),
                ]);
            } else {
                app(ConversationRepository::class)->appendUserMessage($conversation, $content);
            }
        }

        return $conversation->refresh();
    }

    private function connection(User $owner, string $provider = 'example-provider'): ProviderConnection
    {
        return $owner->providerConnections()->create(['provider' => $provider, 'auth_method' => 'oauth']);
    }
}
