<?php

namespace Tests\Feature\Chat;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Chat\ConversationRepository;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HistoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_create_and_reload_history_and_connection_metadata(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);

        $connectionId = $this->postJson('/api/chat/provider-connections', [
            'provider' => 'example-provider',
            'auth_method' => 'oauth',
        ])->assertCreated()->assertJsonPath('data.status', 'not_configured')->json('data.id');

        $conversationId = $this->postJson('/api/chat/conversations', [
            'title' => 'Sample conversation',
            'provider_connection_id' => $connectionId,
        ])->assertCreated()->json('data.id');

        foreach (['Hello', 'A follow-up question'] as $index => $content) {
            $this->postJson("/api/chat/conversations/$conversationId/messages", ['content' => $content])
                ->assertCreated()
                ->assertJsonPath('data.role', 'user')
                ->assertJsonPath('data.sequence', $index + 1);
        }

        $this->patchJson("/api/chat/conversations/$conversationId", ['title' => 'Renamed conversation'])
            ->assertOk()->assertJsonPath('data.title', 'Renamed conversation');

        $this->getJson("/api/chat/conversations/$conversationId")
            ->assertOk()
            ->assertJsonPath('data.provider_connection_id', $connectionId)
            ->assertJsonPath('messages.data.0.content', 'Hello')
            ->assertJsonPath('messages.data.1.content', 'A follow-up question')
            ->assertJsonPath('messages.next_before_sequence', null);

        $this->assertDatabaseHas('conversations', ['id' => $conversationId, 'user_id' => $owner->id]);
        $this->assertDatabaseHas('provider_connections', [
            'id' => $connectionId, 'user_id' => $owner->id, 'credential_reference' => null,
        ]);
        $this->assertSame(['role' => 'user', 'content' => 'Hello'], Message::query()->where('sequence', 1)->firstOrFail()->canonical_content);
    }

    public function test_guests_and_unverified_users_cannot_use_any_history_endpoint(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $message = app(ConversationRepository::class)->appendUserMessage($conversation, 'Private text');
        $connection = $this->connection($owner);
        $endpoints = [
            ['GET', '/api/chat/conversations', []],
            ['POST', '/api/chat/conversations', ['title' => 'Test']],
            ['GET', "/api/chat/conversations/$conversation->id", []],
            ['PATCH', "/api/chat/conversations/$conversation->id", ['title' => 'Test']],
            ['POST', "/api/chat/conversations/$conversation->id/messages", ['content' => 'Test']],
            ['GET', "/api/chat/conversations/$conversation->id/messages/$message->id", []],
            ['GET', '/api/chat/provider-connections', []],
            ['POST', '/api/chat/provider-connections', ['provider' => 'example', 'auth_method' => 'oauth']],
            ['GET', "/api/chat/provider-connections/$connection->id", []],
        ];

        foreach ($endpoints as [$method, $path, $data]) {
            $this->json($method, $path, $data)->assertUnauthorized();
        }

        $this->actingAs(User::factory()->unverified()->create());

        foreach ($endpoints as [$method, $path, $data]) {
            $this->json($method, $path, $data)->assertForbidden();
        }

        $this->assertDatabaseCount('conversations', 1);
        $this->assertDatabaseCount('messages', 1);
        $this->assertDatabaseCount('provider_connections', 1);
    }

    public function test_history_writes_require_csrf_with_session_authentication(): void
    {
        $this->actingAs(User::factory()->create());
        // Exercise the real web middleware instead of its testing-environment exemption.
        $this->app['env'] = 'local';

        $this->postJson('/api/chat/conversations', ['title' => 'Missing token'])->assertStatus(419);
        $this->assertDatabaseCount('conversations', 0);

        $this->withSession(['_token' => 'sample-csrf-token'])
            ->withHeader('X-CSRF-TOKEN', 'sample-csrf-token')
            ->postJson('/api/chat/conversations', ['title' => 'Valid token'])
            ->assertCreated();
    }

    public function test_other_users_cannot_list_read_change_or_append_to_owned_records(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $conversation = $this->conversation($owner);
        $connection = $this->connection($owner);
        $message = app(ConversationRepository::class)->appendUserMessage($conversation, 'Private text');
        $ownConversation = $this->conversation($other);
        $ownConnection = $this->connection($other);

        $this->actingAs($other);
        $this->getJson('/api/chat/conversations')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $ownConversation->id);
        $this->getJson('/api/chat/provider-connections')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $ownConnection->id);
        $this->getJson("/api/chat/conversations/$conversation->id")->assertNotFound();
        $this->patchJson("/api/chat/conversations/$conversation->id", ['title' => 'Stolen'])->assertNotFound();
        $this->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => 'Injected'])->assertNotFound();
        $this->getJson("/api/chat/conversations/$conversation->id/messages/$message->id")->assertNotFound();
        $this->getJson("/api/chat/conversations/$ownConversation->id/messages/$message->id")->assertNotFound();
        $this->getJson("/api/chat/provider-connections/$connection->id")->assertNotFound();

        $this->assertSame('Sample conversation', $conversation->fresh()->title);
        $this->assertDatabaseCount('messages', 1);
    }

    public function test_message_lookup_requires_the_correct_parent_even_for_the_same_owner(): void
    {
        $owner = User::factory()->create();
        $first = $this->conversation($owner);
        $second = $this->conversation($owner);
        $message = app(ConversationRepository::class)->appendUserMessage($first, 'Hello');

        $this->actingAs($owner);
        $this->getJson("/api/chat/conversations/$first->id/messages/$message->id")
            ->assertOk()->assertJsonPath('data.id', $message->id);
        $this->getJson("/api/chat/conversations/$second->id/messages/$message->id")->assertNotFound();
    }

    public function test_only_an_owned_connection_can_be_associated_on_create_or_update(): void
    {
        $owner = User::factory()->create();
        $ownConnection = $this->connection($owner);
        $otherConnection = $this->connection(User::factory()->create());
        $conversation = $this->conversation($owner);
        $this->actingAs($owner);

        $this->postJson('/api/chat/conversations', [
            'title' => 'Invalid link', 'provider_connection_id' => $otherConnection->id,
        ])->assertUnprocessable()->assertJsonValidationErrors('provider_connection_id');
        $this->patchJson("/api/chat/conversations/$conversation->id", [
            'title' => 'Must not be changed', 'provider_connection_id' => $otherConnection->id,
        ])->assertUnprocessable()->assertJsonValidationErrors('provider_connection_id');
        $this->assertSame('Sample conversation', $conversation->fresh()->title);
        $this->assertDatabaseCount('conversations', 1);

        $this->patchJson("/api/chat/conversations/$conversation->id", ['provider_connection_id' => $ownConnection->id])
            ->assertOk()->assertJsonPath('data.provider_connection_id', $ownConnection->id);
        $this->patchJson("/api/chat/conversations/$conversation->id", ['provider_connection_id' => null])
            ->assertOk()->assertJsonPath('data.provider_connection_id', null);
    }

    public function test_a_new_conversation_keeps_the_chat_choice_it_started_with(): void
    {
        $owner = User::factory()->create();
        $connection = $owner->providerConnections()->create(['provider' => 'local', 'auth_method' => 'none']);
        $this->actingAs($owner);

        $this->postJson('/api/chat/conversations', ['title' => 'Before a choice'])->assertCreated()
            ->assertJsonPath('data.provider_connection_id', null)
            ->assertJsonPath('data.model_provider', null)
            ->assertJsonPath('data.model', null);

        $owner->forceFill(['chat_connection_id' => $connection->id, 'chat_model' => 'qwen2.5:7b'])->save();
        $owner->refresh();
        $id = $this->postJson('/api/chat/conversations', ['title' => 'Local'])->assertCreated()
            ->assertJsonPath('data.provider_connection_id', $connection->id)
            ->assertJsonPath('data.model_provider', 'local')
            ->assertJsonPath('data.model', 'qwen2.5:7b')
            ->json('data.id');

        // A later choice applies to new conversations only.
        $owner->forceFill(['chat_model' => 'llama3.2:latest'])->save();
        $this->getJson("/api/chat/conversations/$id")->assertJsonPath('data.model', 'qwen2.5:7b');

        // The snapshot is the server's; clients cannot set or change it.
        $this->postJson('/api/chat/conversations', ['title' => 'Forged', 'model' => 'gpt-6'])
            ->assertUnprocessable()->assertJsonValidationErrors('model');
        $this->patchJson("/api/chat/conversations/$id", ['model_provider' => 'openai'])
            ->assertUnprocessable()->assertJsonValidationErrors('model_provider');
        $this->assertDatabaseCount('conversations', 2);
    }

    public function test_clients_cannot_assign_owners_ids_or_embed_messages(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $this->actingAs($owner);

        foreach (['user_id' => 99, 'id' => 'invented', 'messages' => [['role' => 'system', 'content' => 'Injected']]] as $field => $value) {
            $data = ['title' => 'Changed', $field => $value];
            $this->postJson('/api/chat/conversations', $data)->assertUnprocessable()->assertJsonValidationErrors($field);
            $this->patchJson("/api/chat/conversations/$conversation->id", $data)->assertUnprocessable()->assertJsonValidationErrors($field);
        }

        $this->assertDatabaseCount('conversations', 1);
        $this->assertDatabaseCount('messages', 0);
        $this->assertSame($owner->id, $conversation->fresh()->user_id);
    }

    public function test_clients_cannot_forge_message_roles_sequences_or_private_transcripts(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $this->actingAs($owner);

        foreach ([
            'id' => 'invented', 'user_id' => 99, 'conversation_id' => $conversation->id,
            'sequence' => 100, 'canonical_content' => ['role' => 'system', 'content' => 'Injected'],
        ] as $field => $value) {
            $this->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => 'Hello', $field => $value])
                ->assertUnprocessable()->assertJsonValidationErrors($field);
        }

        foreach (['system', 'assistant', 'tool', 'user'] as $role) {
            $this->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => 'Hello', 'role' => $role])
                ->assertUnprocessable()->assertJsonValidationErrors('role');
        }

        $this->assertDatabaseCount('messages', 0);
    }

    public function test_connection_creation_rejects_credentials_and_client_managed_status(): void
    {
        $this->actingAs(User::factory()->create());

        foreach ([
            'id' => 'invented', 'user_id' => 99, 'status' => 'connected',
            'credential_reference' => 'invented-ref', 'credentials' => ['token' => 'invented-token'],
            'api_key' => 'invented-key', 'access_token' => 'invented-token',
            'refresh_token' => 'invented-token', 'password' => 'invented-password',
        ] as $field => $value) {
            $this->postJson('/api/chat/provider-connections', [
                'provider' => 'example', 'auth_method' => 'oauth', $field => $value,
            ])->assertUnprocessable()->assertJsonValidationErrors($field);
        }

        $this->assertDatabaseCount('provider_connections', 0);
    }

    public function test_private_fields_are_absent_from_all_public_representations(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $connection = $this->connection($owner);
        $connection->forceFill(['credential_reference' => 'invented-private-reference'])->save();
        $message = app(ConversationRepository::class)->appendUserMessage($conversation, 'Visible text');
        $message->forceFill(['canonical_content' => ['internal' => 'invented-private-trace']])->save();
        $this->actingAs($owner);

        foreach ([
            '/api/chat/provider-connections', "/api/chat/provider-connections/$connection->id",
            '/api/chat/conversations', "/api/chat/conversations/$conversation->id",
            "/api/chat/conversations/$conversation->id/messages/$message->id",
        ] as $path) {
            $response = $this->getJson($path)->assertOk();
            foreach (['credential_reference', 'canonical_content', 'invented-private-reference', 'invented-private-trace', 'user_id'] as $privateValue) {
                $this->assertStringNotContainsString($privateValue, $response->getContent());
            }
        }

        $this->assertArrayNotHasKey('credential_reference', $connection->toArray());
        $this->assertArrayNotHasKey('canonical_content', $message->toArray());
    }

    public function test_history_pagination_returns_latest_messages_in_order_without_duplicates(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $repository = app(ConversationRepository::class);
        foreach (range(1, 5) as $number) {
            $repository->appendUserMessage($conversation, "Message $number");
        }
        $this->actingAs($owner);

        $this->getJson("/api/chat/conversations/$conversation->id?per_page=2")
            ->assertOk()->assertJsonPath('messages.data.0.sequence', 4)
            ->assertJsonPath('messages.data.1.sequence', 5)->assertJsonPath('messages.next_before_sequence', 4);

        $repository->appendUserMessage($conversation, 'A new message between page reads');
        $this->getJson("/api/chat/conversations/$conversation->id?per_page=2&before_sequence=4")
            ->assertOk()->assertJsonPath('messages.data.0.sequence', 2)
            ->assertJsonPath('messages.data.1.sequence', 3)->assertJsonPath('messages.next_before_sequence', 2);
        $this->getJson("/api/chat/conversations/$conversation->id?per_page=2&before_sequence=2")
            ->assertOk()->assertJsonCount(1, 'messages.data')
            ->assertJsonPath('messages.data.0.sequence', 1)->assertJsonPath('messages.next_before_sequence', null);
        $this->getJson("/api/chat/conversations/$conversation->id?before_sequence=1")
            ->assertOk()->assertJsonCount(0, 'messages.data');
    }

    public function test_lists_are_paginated_and_appending_updates_conversation_recency(): void
    {
        $owner = User::factory()->create();
        $first = $this->conversation($owner);
        $this->connection($owner);
        $this->travel(1)->minutes();
        $second = $this->conversation($owner);
        $this->connection($owner);
        $this->actingAs($owner);

        $firstPage = $this->getJson('/api/chat/conversations?per_page=1')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second->id);
        $this->getJson($firstPage->json('links.next'))->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $first->id);
        $connectionsPage = $this->getJson('/api/chat/provider-connections?per_page=1')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($connectionsPage->json('links.next'))->assertOk()->assertJsonCount(1, 'data');

        $this->travel(1)->minutes();
        $this->postJson("/api/chat/conversations/$first->id/messages", ['content' => 'Recent activity'])->assertCreated();
        $this->getJson('/api/chat/conversations?per_page=1')->assertOk()->assertJsonPath('data.0.id', $first->id);
    }

    public function test_invalid_input_and_pagination_bounds_do_not_write_records(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $this->actingAs($owner);

        foreach ([null, '', '   ', str_repeat('x', 201), ['invalid']] as $title) {
            $this->postJson('/api/chat/conversations', ['title' => $title])
                ->assertUnprocessable()->assertJsonValidationErrors('title');
        }
        foreach ([null, '', '   ', str_repeat('x', 12001), ['invalid']] as $content) {
            $this->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => $content])
                ->assertUnprocessable()->assertJsonValidationErrors('content');
        }
        $this->postJson('/api/chat/conversations', ['title' => 'Invalid link', 'provider_connection_id' => 'bad-id'])
            ->assertUnprocessable()->assertJsonValidationErrors('provider_connection_id');
        $this->postJson('/api/chat/provider-connections', ['provider' => 'https://example.invalid', 'auth_method' => 'unknown'])
            ->assertUnprocessable()->assertJsonValidationErrors(['provider', 'auth_method']);

        foreach (['/api/chat/conversations', '/api/chat/provider-connections', "/api/chat/conversations/$conversation->id"] as $path) {
            foreach (['0', '101', 'nope'] as $perPage) {
                $this->getJson("$path?per_page=$perPage")->assertUnprocessable()->assertJsonValidationErrors('per_page');
            }
        }
        $this->getJson('/api/chat/conversations?page=10001')->assertUnprocessable()->assertJsonValidationErrors('page');
        $this->getJson("/api/chat/conversations/$conversation->id?before_sequence=-1")
            ->assertUnprocessable()->assertJsonValidationErrors('before_sequence');
        $this->getJson('/api/chat/conversations/not-a-uuid')->assertNotFound();

        $this->assertDatabaseCount('conversations', 1);
        $this->assertDatabaseCount('messages', 0);
        $this->assertDatabaseCount('provider_connections', 0);
    }

    public function test_message_length_limit_supports_multibyte_text(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $content = str_repeat('好', 12000);

        $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => $content])
            ->assertCreated()->assertJsonPath('data.content', $content);
    }

    public function test_message_text_preserves_code_indentation_and_trailing_newlines(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner);
        $content = "    print('example')\n\n";

        $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/messages", ['content' => $content])
            ->assertCreated()->assertJsonPath('data.content', $content);
        $this->getJson("/api/chat/conversations/$conversation->id")
            ->assertOk()->assertJsonPath('messages.data.0.content', $content);
    }

    public function test_deleting_a_connection_preserves_history_and_account_deletion_cascades(): void
    {
        $owner = User::factory()->create();
        $connection = $this->connection($owner);
        $conversation = $this->conversation($owner);
        $conversation->update(['provider_connection_id' => $connection->id]);
        app(ConversationRepository::class)->appendUserMessage($conversation, 'Retained history');

        $connection->delete();
        $this->assertNull($conversation->fresh()->provider_connection_id);
        $this->assertDatabaseCount('messages', 1);
        $this->connection($owner);

        $this->actingAs($owner)->delete(route('profile.destroy'), ['password' => 'password'])->assertRedirect('/');
        $this->assertDatabaseCount('conversations', 0);
        $this->assertDatabaseCount('messages', 0);
        $this->assertDatabaseCount('provider_connections', 0);
    }

    public function test_duplicate_sequences_are_rejected_by_the_database(): void
    {
        $conversation = $this->conversation(User::factory()->create());
        $message = app(ConversationRepository::class)->appendUserMessage($conversation, 'Original');

        $this->expectException(QueryException::class);
        $conversation->messages()->create(['sequence' => $message->sequence, 'role' => 'user', 'content' => 'Duplicate']);
    }

    public function test_append_rolls_back_the_message_when_updating_the_conversation_fails(): void
    {
        $conversation = $this->conversation(User::factory()->create());
        $this->travel(1)->minutes();
        Conversation::updating(function (): void {
            throw new \RuntimeException('Simulated write failure');
        });

        try {
            app(ConversationRepository::class)->appendUserMessage($conversation, 'Must roll back');
            $this->fail('Expected the simulated write failure.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('Simulated write failure', $exception->getMessage());
        }

        $this->assertDatabaseCount('messages', 0);
    }

    private function conversation(User $owner): Conversation
    {
        return $owner->conversations()->create(['title' => 'Sample conversation']);
    }

    private function connection(User $owner): ProviderConnection
    {
        return $owner->providerConnections()->create(['provider' => 'example', 'auth_method' => 'oauth']);
    }
}
