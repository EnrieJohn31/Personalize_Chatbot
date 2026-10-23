<?php

namespace Tests\Fakes;

use App\Contracts\AgentGateway;
use App\Data\Agent\RunAcknowledgement;
use App\Data\Agent\RunEvent;
use App\Data\Agent\RunRequest;
use App\Services\Ai\AgentGatewayException;
use Generator;

/** Scripted engine for controller tests: records calls and replays configured events. */
final class FakeAgentGateway implements AgentGateway
{
    /** @var list<RunRequest> */
    public array $submitted = [];

    /** @var list<string> */
    public array $cancelled = [];

    /** @var list<array{string, int}> */
    public array $reads = [];

    public ?AgentGatewayException $submitFailure = null;

    public ?AgentGatewayException $cancelFailure = null;

    /** @var list<array{0: string, 1?: array<string, mixed>}|AgentGatewayException> */
    public array $script = [];

    /** A complete successful run whose deltas add up to $text. */
    public function completes(string $text = 'Simulated **reply**.'): self
    {
        $this->script = [
            ['run.started'],
            ['run.progress', ['stage' => 'answering']],
            ['assistant.delta', ['text' => 'Simulated ']],
            ['assistant.delta', ['text' => '**reply**.']],
            ['assistant.final', ['text' => $text]],
            ['run.completed'],
        ];

        return $this;
    }

    public function submit(RunRequest $request): RunAcknowledgement
    {
        if ($this->submitFailure !== null) {
            throw $this->submitFailure;
        }

        $this->submitted[] = $request;

        return new RunAcknowledgement($request->runId, 'accepted', false);
    }

    public function cancel(string $runId): RunAcknowledgement
    {
        if ($this->cancelFailure !== null) {
            throw $this->cancelFailure;
        }

        $this->cancelled[] = $runId;

        return new RunAcknowledgement($runId, 'cancel_requested', false);
    }

    /** @return Generator<int, RunEvent> */
    public function events(string $runId, int $after = 0): Generator
    {
        $this->reads[] = [$runId, $after];
        $sequence = 0;

        foreach ($this->script as $step) {
            if ($step instanceof AgentGatewayException) {
                throw $step;
            }

            $sequence++;
            if ($sequence > $after) {
                yield new RunEvent($runId, $sequence, $step[0], $step[1] ?? []);
            }
        }
    }

    public function health(): array
    {
        return ['status' => 'ok', 'providerAuth' => 'not_configured', 'requestAuth' => 'configured', 'simulation' => 'enabled'];
    }
}
