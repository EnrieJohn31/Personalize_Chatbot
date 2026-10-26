<?php

namespace Tests\Feature\Chat;

use App\Contracts\AgentGateway;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\ProviderConnection;
use App\Models\User;
use App\Services\Ai\AgentGatewayException;
use App\Services\Chat\ConversationRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Fakes\FakeAgentGateway;
use Tests\TestCase;

class ChatRunTest extends TestCase
{
    use RefreshDatabase;

    private FakeAgentGateway $engine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->engine = new FakeAgentGateway;
        $this->app->instance(AgentGateway::class, $this->engine);
    }

    public function test_an_owner_starts_a_run_for_the_pending_user_message(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();

        $runId = $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertAccepted()
            ->assertJsonPath('data.conversation_id', $conversation->id)
            ->json('data.id');

        $this->assertCount(1, $this->engine->submitted);
        $this->assertSame($runId, $this->engine->submitted[0]->runId);
        $this->assertSame('What is the plan?', $this->engine->submitted[0]->messages[0]['content']);
        $this->getJson("/api/chat/conversations/$conversation->id")->assertJsonCount(1, 'messages.data');
    }

    public function test_runs_require_the_owner_and_a_pending_user_message(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();

        $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertUnauthorized();
        $this->actingAs(User::factory()->create())
            ->postJson("/api/chat/conversations/$conversation->id/runs")->assertNotFound();

        $answered = $owner->conversations()->create(['title' => 'Answered']);
        app(ConversationRepository::class)->appendUserMessage($answered, 'Question');
        app(ConversationRepository::class)->appendAssistantMessage($answered, 'Answer', '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e');
        $this->actingAs($owner)->postJson("/api/chat/conversations/$answered->id/runs")
            ->assertStatus(409)->assertJsonPath('code', 'no_pending_user_message');

        $this->assertSame([], $this->engine->submitted);
    }

    public function test_a_user_has_at_most_one_reply_in_progress(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        $other = $owner->conversations()->create(['title' => 'Other']);
        app(ConversationRepository::class)->appendUserMessage($other, 'Second question');
        $this->actingAs($owner);

        $first = $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted()->json('data.id');

        $this->postJson("/api/chat/conversations/$other->id/runs")
            ->assertStatus(409)
            ->assertJsonPath('code', 'run_in_progress')
            ->assertJsonPath('run.id', $first)
            ->assertJsonPath('run.conversation_id', $conversation->id);
        $this->assertCount(1, $this->engine->submitted);
    }

    public function test_failed_admission_reports_the_cause_and_frees_the_slot(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        $this->actingAs($owner);

        $this->engine->submitFailure = AgentGatewayException::rejected(422, 'model_unavailable', 'No provider.');
        $this->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(503)->assertJsonPath('code', 'assistant_unavailable');

        $this->engine->submitFailure = AgentGatewayException::unavailable(null);
        $this->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(503)->assertJsonPath('code', 'engine_unavailable');

        $this->engine->submitFailure = null;
        $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted();
    }

    public function test_a_reply_that_looks_something_up_relays_its_tool_events_and_saves_only_the_answer(): void
    {
        $tool = ['toolCallId' => 'call_1', 'name' => 'lookup_reference'];
        [, , $runId] = $this->startedRun(function (FakeAgentGateway $engine) use ($tool): void {
            $engine->script = [
                ['run.started'],
                ['run.progress', ['stage' => 'retrieving']],
                ['tool.started', $tool],
                ['source.added', ['toolCallId' => 'call_1', 'evidenceId' => 'ref-sample-office', 'title' => 'Sample office', 'locator' => 'fixture://reference/offices#SAMPLE-001', 'checkedAt' => '2026-10-01']],
                ['tool.finished', [...$tool, 'outcome' => 'ok', 'message' => null]],
                ['run.progress', ['stage' => 'answering']],
                ['assistant.delta', ['text' => 'The code is SAMPLE-001.']],
                ['assistant.final', ['text' => 'The code is SAMPLE-001.']],
                ['run.completed'],
            ];
        });

        $events = $this->events($this->get("/api/chat/runs/$runId/events"));

        $this->assertSame(
            ['run.started', 'run.progress', 'tool.started', 'source.added', 'tool.finished', 'run.progress', 'assistant.delta', 'assistant.final', 'run.completed'],
            array_column($events, 'event'),
        );
        $this->assertSame('ref-sample-office', $events[3]['data']['evidenceId']);
        $this->assertSame('The code is SAMPLE-001.', Message::query()->where('role', 'assistant')->sole()->content);
    }

    public function test_the_stream_relays_events_and_saves_the_reply_once_on_the_server(): void
    {
        [$owner, $conversation, $runId] = $this->startedRun(fn (FakeAgentGateway $engine) => $engine->completes());

        $response = $this->get("/api/chat/runs/$runId/events")->assertOk();
        $events = $this->events($response);

        $this->assertStringStartsWith('text/event-stream', (string) $response->headers->get('Content-Type'));
        $this->assertSame(['run.started', 'run.progress', 'assistant.delta', 'assistant.delta', 'assistant.final', 'run.completed'], array_column($events, 'event'));
        $this->assertSame(['1', '2', '3', '4', '5', '6'], array_column($events, 'id'));
        $this->assertSame('Simulated ', $events[2]['data']['text']);
        $this->assertSame($runId, $events[2]['data']['runId']);

        $saved = Message::query()->where('role', 'assistant')->sole();
        $this->assertSame('Simulated **reply**.', $saved->content);
        $this->assertSame($runId, $saved->canonical_content['run_id']);
        $this->assertSame(['simulated', 'simulated-echo'], [$saved->canonical_content['provider'], $saved->canonical_content['model']]);
        $this->assertSame($saved->id, $events[5]['data']['message']['id']);
        $this->assertSame(2, $events[5]['data']['message']['sequence']);
        // Built-in replies are not labelled with a model.
        $this->assertNull($events[5]['data']['message']['model']);
        $this->assertArrayNotHasKey('canonical_content', $events[5]['data']['message']);

        // The finished run neither streams again nor blocks the next reply.
        $this->get("/api/chat/runs/$runId/events")->assertNoContent();
        app(ConversationRepository::class)->appendUserMessage($conversation, 'Follow-up');
        $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted();
    }

    public function test_a_live_reply_uses_the_conversations_model_and_records_it(): void
    {
        config(['assistant.live_replies' => true]);
        [$owner, $conversation] = $this->conversationWithQuestion();
        $connection = $owner->providerConnections()->create(['provider' => 'local', 'auth_method' => 'none']);
        $connection->forceFill(['status' => 'connected'])->save();
        $conversation->forceFill(['provider_connection_id' => $connection->id, 'model_provider' => 'local', 'model' => 'qwen2.5:7b'])->save();
        $this->engine->completes();

        $runId = $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted()->json('data.id');
        $submitted = $this->engine->submitted[0];
        $this->assertSame(['local', 'qwen2.5:7b', $connection->id], [$submitted->modelProvider, $submitted->modelId, $submitted->connectionId]);

        $this->assertSame('qwen2.5:7b', last($this->events($this->get("/api/chat/runs/$runId/events")))['data']['message']['model']);
        $saved = Message::query()->where('role', 'assistant')->sole();
        $this->assertSame(['local', 'qwen2.5:7b'], [$saved->canonical_content['provider'], $saved->canonical_content['model']]);
        $this->getJson("/api/chat/conversations/$conversation->id")
            ->assertJsonPath('messages.data.0.role', 'user')
            ->assertJsonPath('messages.data.0.model', null)
            ->assertJsonPath('messages.data.1.model', 'qwen2.5:7b');
    }

    public function test_a_conversation_whose_account_cannot_answer_points_to_connections(): void
    {
        config(['assistant.live_replies' => true]);
        [$owner, $conversation] = $this->conversationWithQuestion();
        $connection = $owner->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $conversation->forceFill(['provider_connection_id' => $connection->id, 'model_provider' => 'openai', 'model' => 'gpt-5.4-mini'])->save();
        $this->actingAs($owner);

        $this->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(409)
            ->assertJsonPath('code', 'connection_not_ready')
            ->assertJsonPath('message', "This chat's account needs attention. Check it on the Connections page.");

        $conversation->forceFill(['provider_connection_id' => null])->save();
        $this->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(409)
            ->assertJsonPath('code', 'connection_required')
            ->assertJsonPath('message', "This chat's account is no longer connected. Connect it again on the Connections page.");
        $this->assertSame([], $this->engine->submitted);
    }

    public function test_a_conversation_without_a_model_answers_with_the_current_choice_from_its_first_live_reply(): void
    {
        config(['assistant.reasoning' => 'high']);
        [$owner, $conversation] = $this->conversationWithQuestion();
        $connection = $this->connected($owner);
        $owner->forceFill(['chat_connection_id' => $connection->id, 'chat_model' => 'gpt-6-luna'])->save();

        $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted();

        $submitted = $this->engine->submitted[0];
        $this->assertSame(['openai', 'gpt-6-luna', $connection->id, 'high'], [$submitted->modelProvider, $submitted->modelId, $submitted->connectionId, $submitted->modelReasoning]);
        $this->assertSame([$connection->id, 'openai', 'gpt-6-luna'], [$conversation->fresh()->provider_connection_id, $conversation->fresh()->model_provider, $conversation->fresh()->model]);
    }

    public function test_a_reply_rejected_for_its_sign_in_marks_the_connection_and_blocks_the_next_reply(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        $connection = $this->connected($owner);
        $conversation->forceFill(['provider_connection_id' => $connection->id, 'model_provider' => 'openai', 'model' => 'gpt-6-luna'])->save();

        // An ordinary provider error is not a sign-in problem.
        $runId = $this->startWith($owner, $conversation, ['provider_error', 'You exceeded your current quota.']);
        $this->assertSame('run.failed', last($this->events($this->get("/api/chat/runs/$runId/events")))['event']);
        $this->assertSame('connected', $connection->refresh()->status);

        $runId = $this->startWith($owner, $conversation, ['reauth_required', 'The sign-in has expired or was revoked. Sign in again.']);
        $failed = last($this->events($this->get("/api/chat/runs/$runId/events")));
        $this->assertSame(['run.failed', 'reauth_required'], [$failed['event'], $failed['data']['code']]);
        $this->assertSame('reauth_required', $connection->refresh()->status);
        $this->assertSame(0, Message::query()->where('role', 'assistant')->count());

        $this->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(409)->assertJsonPath('code', 'connection_not_ready');
    }

    public function test_an_engine_refusing_a_run_without_its_connection_points_to_connections(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        $this->engine->submitFailure = AgentGatewayException::rejected(422, 'connection_required', "openai/gpt-6-luna needs the run's own provider connection.");

        $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")
            ->assertStatus(409)
            ->assertJsonPath('code', 'connection_required')
            ->assertJsonPath('message', "This chat's account is no longer connected. Connect it again on the Connections page.");
    }

    public function test_starting_replies_is_rate_limited(): void
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        app(ConversationRepository::class)->appendAssistantMessage($conversation, 'Answered.', '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e');
        $this->actingAs($owner);

        for ($attempt = 0; $attempt < 20; $attempt++) {
            $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertStatus(409);
        }

        $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertTooManyRequests();
    }

    public function test_a_resumed_stream_skips_seen_events_but_still_saves_the_reply(): void
    {
        [, , $runId] = $this->startedRun(fn (FakeAgentGateway $engine) => $engine->completes());

        $events = $this->events($this->get("/api/chat/runs/$runId/events", ['Last-Event-ID' => '4']));

        $this->assertSame(['5', '6'], array_column($events, 'id'));
        $this->assertSame([[$runId, 0]], $this->engine->reads, 'the relay reads from the start to know the final text');
        $this->assertSame(1, Message::query()->where('role', 'assistant')->count());
    }

    public function test_saving_the_same_run_twice_stores_one_message(): void
    {
        [, $conversation] = $this->conversationWithQuestion();
        $repository = app(ConversationRepository::class);
        $runId = '0199f2a0-7c1e-7a3b-9d4e-5f6a7b8c9d0e';

        $first = $repository->appendAssistantMessage($conversation, 'Answer', $runId);
        $second = $repository->appendAssistantMessage($conversation, 'Answer', $runId);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(2, $conversation->messages()->count());
    }

    public function test_cancelled_and_failed_runs_save_nothing(): void
    {
        foreach (['run.cancelled' => [], 'run.failed' => ['code' => 'deadline_exceeded', 'message' => 'Too slow.']] as $type => $data) {
            [, , $runId] = $this->startedRun(function (FakeAgentGateway $engine) use ($type, $data): void {
                $engine->script = [['run.started'], ['assistant.delta', ['text' => 'Partial']], [$type, $data]];
            });

            $events = $this->events($this->get("/api/chat/runs/$runId/events"));

            $this->assertSame($type, end($events)['event']);
            $this->assertSame(0, Message::query()->where('role', 'assistant')->count());
            $this->get("/api/chat/runs/$runId/events")->assertNoContent();
        }
    }

    public function test_an_interrupted_stream_can_be_resumed(): void
    {
        [, , $runId] = $this->startedRun(function (FakeAgentGateway $engine): void {
            $engine->script = [['run.started'], AgentGatewayException::streamInterrupted()];
        });

        $events = $this->events($this->get("/api/chat/runs/$runId/events"));

        $this->assertSame(['stream.error', null], [end($events)['event'], end($events)['id']]);
        $this->assertSame(['code' => 'stream_interrupted', 'resumable' => true], array_intersect_key(end($events)['data'], ['code' => 1, 'resumable' => 1]));
        $this->engine->completes();
        $this->assertSame('run.completed', last($this->events($this->get("/api/chat/runs/$runId/events")))['event']);
    }

    public function test_an_engine_contract_violation_stops_the_run_and_frees_the_slot(): void
    {
        [, $conversation, $runId] = $this->startedRun(function (FakeAgentGateway $engine): void {
            $engine->script = [['run.started'], AgentGatewayException::invalidResponse(200, 'bad event')];
        });

        $last = last($this->events($this->get("/api/chat/runs/$runId/events")));

        $this->assertSame(['stream.error', 'relay_failed', false], [$last['event'], $last['data']['code'], $last['data']['resumable']]);
        $this->assertSame([$runId], $this->engine->cancelled);
        $this->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted();
    }

    public function test_only_the_owner_can_follow_or_stop_a_run(): void
    {
        [, , $runId] = $this->startedRun(fn (FakeAgentGateway $engine) => $engine->completes());
        $this->actingAs(User::factory()->create());

        $this->get("/api/chat/runs/$runId/events")->assertNotFound();
        $this->deleteJson("/api/chat/runs/$runId")->assertNotFound();
        $this->get('/api/chat/runs/0199f2a0-7c1e-7a3b-9d4e-000000000000/events')->assertNotFound();
        $this->assertSame([], $this->engine->reads);
        $this->assertSame([], $this->engine->cancelled);
    }

    public function test_a_cancelled_tool_run_relays_its_outcome_saves_no_answer_and_releases_the_slot(): void
    {
        [$owner, $conversation, $runId] = $this->startedRun(function (FakeAgentGateway $engine): void {
            $engine->script = [
                ['run.started'],
                ['assistant.delta', ['text' => 'Let me check.']],
                ['tool.started', ['toolCallId' => 'call_1', 'name' => 'lookup_reference']],
                ['tool.finished', ['toolCallId' => 'call_1', 'name' => 'lookup_reference', 'outcome' => 'cancelled', 'message' => 'This reply was stopped.']],
                ['run.cancelled'],
            ];
        });

        $this->deleteJson("/api/chat/runs/$runId")->assertAccepted();
        $events = $this->events($this->get("/api/chat/runs/$runId/events"));

        $this->assertSame('cancelled', $events[3]['data']['outcome']);
        $this->assertSame('run.cancelled', last($events)['event']);
        $this->assertSame(0, $conversation->messages()->where('role', 'assistant')->count());
        $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted();
    }

    public function test_stop_asks_the_engine_to_cancel(): void
    {
        [, , $runId] = $this->startedRun(fn (FakeAgentGateway $engine) => $engine->completes());

        $this->deleteJson("/api/chat/runs/$runId")->assertAccepted()->assertJsonPath('data.status', 'cancel_requested');
        $this->assertSame([$runId], $this->engine->cancelled);

        $this->engine->cancelFailure = AgentGatewayException::rejected(404, 'run_not_found', 'Unknown.');
        $this->deleteJson("/api/chat/runs/$runId")->assertNotFound()->assertJsonPath('code', 'run_not_found');
    }

    public function test_the_chat_page_offers_the_active_run_for_resuming(): void
    {
        [$owner, $conversation, $runId] = $this->startedRun(fn (FakeAgentGateway $engine) => $engine->completes());

        $this->get("/chat/$conversation->id")->assertInertia(fn (Assert $page) => $page
            ->where('active_run.id', $runId)
            ->where('active_run.events_url', "/api/chat/runs/$runId/events"));

        $this->get("/api/chat/runs/$runId/events")->assertOk()->streamedContent();
        $this->actingAs($owner)->get("/chat/$conversation->id")
            ->assertInertia(fn (Assert $page) => $page->where('active_run', null)->has('messages.data', 2));
    }

    /** @return array{User, Conversation} */
    private function conversationWithQuestion(): array
    {
        $owner = User::factory()->create();
        $conversation = $owner->conversations()->create(['title' => 'Plan']);
        app(ConversationRepository::class)->appendUserMessage($conversation, 'What is the plan?');

        return [$owner, $conversation];
    }

    private function connected(User $owner): ProviderConnection
    {
        $connection = $owner->providerConnections()->create(['provider' => 'openai', 'auth_method' => 'oauth']);
        $connection->forceFill(['status' => 'connected'])->save();

        return $connection;
    }

    /**
     * Starts a reply that the engine ends with this failure, and returns its run ID.
     *
     * @param  array{string, string}  $failure  code and message
     */
    private function startWith(User $owner, Conversation $conversation, array $failure): string
    {
        $this->engine->script = [['run.started'], ['run.failed', ['code' => $failure[0], 'message' => $failure[1]]]];

        return $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")->assertAccepted()->json('data.id');
    }

    /**
     * @param  callable(FakeAgentGateway): mixed  $script
     * @return array{User, Conversation, string}
     */
    private function startedRun(callable $script): array
    {
        [$owner, $conversation] = $this->conversationWithQuestion();
        $script($this->engine);
        $runId = $this->actingAs($owner)->postJson("/api/chat/conversations/$conversation->id/runs")->json('data.id');

        return [$owner, $conversation, $runId];
    }

    /** @return list<array{id: string|null, event: string, data: array<string, mixed>}> */
    private function events(TestResponse $response): array
    {
        $events = [];
        foreach (array_filter(explode("\n\n", $response->streamedContent())) as $frame) {
            $fields = ['id' => null, 'event' => null, 'data' => null];
            foreach (explode("\n", $frame) as $line) {
                [$name, $value] = explode(': ', $line, 2);
                $fields[$name] = $value;
            }
            $events[] = [...$fields, 'data' => json_decode((string) $fields['data'], true, flags: JSON_THROW_ON_ERROR)];
        }

        return $events;
    }
}
