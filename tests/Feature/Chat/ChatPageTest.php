<?php

namespace Tests\Feature\Chat;

use App\Models\Conversation;
use App\Models\User;
use App\Services\Chat\ConversationRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class ChatPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_and_unverified_users_cannot_open_the_chat_page(): void
    {
        $conversation = $this->conversation(User::factory()->create(), []);

        $this->get('/chat')->assertRedirect(route('login'));
        $this->get("/chat/$conversation->id")->assertRedirect(route('login'));

        $this->actingAs(User::factory()->unverified()->create());
        $this->get('/chat')->assertRedirect(route('verification.notice'));
    }

    public function test_new_chat_page_lists_only_the_owners_conversations_newest_first(): void
    {
        $owner = User::factory()->create();
        $older = $this->conversation($owner, ['First']);
        $newer = $this->conversation($owner, ['Second']);
        $this->conversation(User::factory()->create(), ['Someone else']);
        DB::table('conversations')->where('id', $older->id)->update(['updated_at' => now()->subDay()]);

        $this->actingAs($owner)->get('/chat')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('chat/index')
                ->has('conversations.data', 2)
                ->where('conversations.data.0.id', $newer->id)
                ->where('conversations.data.1.id', $older->id)
                ->where('conversations.next_page_url', null)
                ->where('conversation', null)
                ->where('messages', null));
    }

    public function test_more_conversations_are_offered_through_the_json_list_endpoint(): void
    {
        $owner = User::factory()->create();
        foreach (range(1, 26) as $index) {
            $owner->conversations()->create(['title' => "Conversation $index"]);
        }

        $this->actingAs($owner)->get('/chat')
            ->assertInertia(fn (Assert $page) => $page
                ->has('conversations.data', 25)
                ->where('conversations.next_page_url', '/api/chat/conversations?page=2'));

        $this->getJson('/api/chat/conversations?page=2')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_conversation_page_loads_its_latest_history_in_order(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, array_map(fn (int $i) => "Message $i", range(1, 52)));

        $this->actingAs($owner)->get("/chat/$conversation->id")
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('chat/index')
                ->where('conversation.id', $conversation->id)
                ->where('conversation.title', 'Sample conversation')
                ->has('messages.data', 50)
                ->where('messages.data.0.content', 'Message 3')
                ->where('messages.data.49.content', 'Message 52')
                ->where('messages.next_before_sequence', 3)
                ->where('messages.per_page', 50));

        // The JSON endpoint shares the same paging rule for older pages.
        $this->getJson("/api/chat/conversations/$conversation->id?before_sequence=3")
            ->assertOk()
            ->assertJsonPath('messages.data.0.content', 'Message 1')
            ->assertJsonPath('messages.next_before_sequence', null)
            ->assertJsonMissingPath('messages.messages');
    }

    public function test_page_props_exclude_private_fields(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, ['Hello']);

        $this->actingAs($owner)->get("/chat/$conversation->id")
            ->assertInertia(fn (Assert $page) => $page
                ->missing('conversation.user_id')
                ->missing('messages.data.0.canonical_content')
                ->missing('conversations.data.0.user_id'));
    }

    public function test_the_page_says_which_account_and_model_answer(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner)->get('/chat')->assertInertia(fn (Assert $page) => $page
            ->where('assistant', ['provider' => null, 'name' => 'Built-in assistant', 'model' => null, 'ready' => true, 'live' => true]));

        $connection = $owner->providerConnections()->create(['provider' => 'local', 'auth_method' => 'none']);
        $connection->forceFill(['status' => 'connected'])->save();
        $owner->forceFill(['chat_connection_id' => $connection->id, 'chat_model' => 'qwen2.5:7b'])->save();
        $owner->refresh();
        $this->get('/chat')->assertInertia(fn (Assert $page) => $page
            ->where('assistant', ['provider' => 'local', 'name' => 'Local model', 'model' => 'qwen2.5:7b', 'ready' => true, 'live' => true]));

        // A conversation shows what it started with, not the current choice.
        $older = $this->conversation($owner, ['Hello']);
        $this->get("/chat/$older->id")->assertInertia(fn (Assert $page) => $page->where('assistant.provider', null));
    }

    public function test_a_conversation_whose_account_is_down_is_marked_not_ready(): void
    {
        config(['assistant.live_replies' => true]);
        $owner = User::factory()->create();
        $connection = $owner->providerConnections()->create(['provider' => 'local', 'auth_method' => 'none']);
        $connection->forceFill(['status' => 'unreachable'])->save();
        $conversation = $this->conversation($owner, ['Hello']);
        $conversation->forceFill(['provider_connection_id' => $connection->id, 'model_provider' => 'local', 'model' => 'llama3.2:latest'])->save();

        $this->actingAs($owner)->get("/chat/$conversation->id")->assertInertia(fn (Assert $page) => $page
            ->where('assistant', ['provider' => 'local', 'name' => 'Local model', 'model' => 'llama3.2:latest', 'ready' => false, 'live' => true]));
    }

    public function test_another_users_conversation_and_malformed_ids_are_not_found(): void
    {
        $conversation = $this->conversation(User::factory()->create(), ['Private']);
        $this->actingAs(User::factory()->create());

        $this->get("/chat/$conversation->id")->assertNotFound();
        $this->get('/chat/not-a-uuid')->assertNotFound();
    }

    /** @param  list<string>  $messages */
    private function conversation(User $owner, array $messages): Conversation
    {
        $conversation = $owner->conversations()->create(['title' => 'Sample conversation']);
        foreach ($messages as $content) {
            app(ConversationRepository::class)->appendUserMessage($conversation, $content);
        }

        return $conversation;
    }
}
