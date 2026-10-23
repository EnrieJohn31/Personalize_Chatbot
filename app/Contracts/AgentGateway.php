<?php

namespace App\Contracts;

use App\Data\Agent\RunAcknowledgement;
use App\Data\Agent\RunRequest;
use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\PiGateway;
use Illuminate\Container\Attributes\Bind;

/**
 * Small boundary to the private engine. Implementations hand work to the engine; they never
 * run a model or tool loop in PHP. An acknowledgement means admitted, not completed.
 */
#[Bind(PiGateway::class)]
interface AgentGateway
{
    /**
     * Admit a server-created run. Resubmitting the same request is idempotent, so a lost
     * response is resolved by sending the same run again, never by creating a new run.
     *
     * @throws AgentGatewayException
     */
    public function submit(RunRequest $request): RunAcknowledgement;

    /**
     * Ask the engine to stop a run. Laravel's persisted cancellation stays authoritative.
     *
     * @throws AgentGatewayException
     */
    public function cancel(string $runId): RunAcknowledgement;

    /**
     * Process readiness without a billable model call.
     *
     * @return array{status: string, providerAuth: string, requestAuth: string, simulation: string}
     *
     * @throws AgentGatewayException
     */
    public function health(): array;
}
