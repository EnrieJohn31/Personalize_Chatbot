<?php

namespace Tests\Feature\Chat;

use App\Contracts\AgentGateway;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Services\Chat\ConversationRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Fakes\FakeAgentGateway;
use Tests\TestCase;

class ConversationDeletionTest extends TestCase
{
    use RefreshDatabase;

    private FakeAgentGateway $engine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->engine = new FakeAgentGateway;
        $this->app->instance(AgentGateway::class, $this->engine);
    }

    public function test_an_owner_deletes_a_conversation_with_its_messages(): void
    {
        $owner = User::factory()->create();
        $doomed = $this->conversation($owner, 'Doomed');
        $kept = $this->conversation($owner, 'Kept');

        $this->actingAs($owner)->deleteJson("/api/chat/conversations/$doomed->id")
            ->assertOk()
            ->assertExactJson(['deleted' => [$doomed->id]]);

        $this->assertModelMissing($doomed);
        $this->assertSame(0, Message::query()->where('conversation_id', $doomed->id)->count());
        $this->assertModelExists($kept);
        $this->getJson("/api/chat/conversations/$doomed->id")->assertNotFound();
        $this->get("/chat/$doomed->id")->assertNotFound();
    }

    public function test_only_the_owner_can_delete_a_conversation(): void
    {
        $conversation = $this->conversation(User::factory()->create(), 'Private');

        $this->deleteJson("/api/chat/conversations/$conversation->id")->assertUnauthorized();
        $this->actingAs(User::factory()->unverified()->create())
            ->deleteJson("/api/chat/conversations/$conversation->id")->assertForbidden();
        $this->actingAs(User::factory()->create())
            ->deleteJson("/api/chat/conversations/$conversation->id")->assertNotFound();

        $this->assertModelExists($conversation);
    }

    public function test_several_conversations_are_deleted_together_and_foreign_ids_are_ignored(): void
    {
        $owner = User::factory()->create();
        [$first, $second, $third] = [$this->conversation($owner, 'One'), $this->conversation($owner, 'Two'), $this->conversation($owner, 'Three')];
        $someoneElses = $this->conversation(User::factory()->create(), 'Theirs');
        $unknown = (string) Str::uuid();

        $deleted = $this->actingAs($owner)->deleteJson('/api/chat/conversations', ['ids' => [$first->id, $third->id, $someoneElses->id, $unknown]])
            ->assertOk()
            ->json('deleted');

        $this->assertEqualsCanonicalizing([$first->id, $third->id], $deleted);
        $this->assertModelMissing($first);
        $this->assertModelMissing($third);
        $this->assertModelExists($second);
        $this->assertModelExists($someoneElses);
    }

    public function test_bulk_deletion_validates_its_list(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, 'Kept');
        $this->actingAs($owner);

        foreach ([[], ['ids' => []], ['ids' => ['not-a-uuid']], ['ids' => [$conversation->id, $conversation->id]], ['ids' => array_map(fn () => (string) Str::uuid(), range(1, 101))]] as $payload) {
            $this->deleteJson('/api/chat/conversations', $payload)->assertUnprocessable();
        }

        $this->assertModelExists($conversation);
    }

    public function test_deleting_a_conversation_stops_its_reply_and_frees_the_reply_slot(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, 'Streaming');
        $this->actingAs($owner);
        $runId = $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted()->json('data.id');

        $this->deleteJson("/api/chat/conversations/$conversation->id")->assertOk();

        $this->assertSame([$runId], $this->engine->cancelled);
        $this->get("/api/chat/runs/$runId/events")->assertNoContent();
        $other = $this->conversation($owner, 'Next');
        $this->postJson("/api/chat/conversations/$other->id/runs")->assertAccepted();
    }

    public function test_deleting_other_conversations_leaves_a_running_reply_alone(): void
    {
        $owner = User::factory()->create();
        $streaming = $this->conversation($owner, 'Streaming');
        $idle = $this->conversation($owner, 'Idle');
        $this->actingAs($owner);
        $this->postJson("/api/chat/conversations/$streaming->id/runs")->assertAccepted();

        $this->deleteJson('/api/chat/conversations', ['ids' => [$idle->id]])->assertOk();

        $this->assertSame([], $this->engine->cancelled);
    }

    public function test_a_reply_whose_conversation_was_deleted_mid_stream_ends_without_saving(): void
    {
        $owner = User::factory()->create();
        $conversation = $this->conversation($owner, 'Vanishing');
        $this->actingAs($owner);
        $runId = $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted()->json('data.id');
        $this->engine->script = [
            ['run.started'],
            ['assistant.final', ['text' => 'Too late.']],
            fn () => Conversation::query()->whereKey($conversation->id)->delete(),
            ['run.completed'],
        ];

        $stream = $this->get("/api/chat/runs/$runId/events")->assertOk()->streamedContent();

        $this->assertStringContainsString('event: stream.error', $stream);
        $this->assertStringContainsString('"code":"conversation_deleted"', $stream);
        $this->assertSame(0, Message::query()->where('role', 'assistant')->count());
        $this->assertSame([$runId], $this->engine->cancelled);
        // The reply slot is free again.
        $this->postJson('/api/chat/conversations/'.$this->conversation($owner, 'Next')->id.'/runs')->assertAccepted();
    }

    private function conversation(User $owner, string $title): Conversation
    {
        $conversation = $owner->conversations()->create(['title' => $title]);
        app(ConversationRepository::class)->appendUserMessage($conversation, "Question for $title");

        return $conversation;
    }
}
