<?php

namespace App\Console\Commands;

use App\Services\Ai\AgentGatewayException;
use App\Services\Ai\PiGateway;
use Illuminate\Console\Command;

class CheckAgentConnection extends Command
{
    protected $signature = 'agent:check';

    protected $description = 'Check private engine health and request signing without starting a run';

    public function handle(PiGateway $gateway): int
    {
        try {
            foreach ($gateway->health() as $name => $value) {
                $this->components->twoColumnDetail("Engine $name", $value);
            }

            $gateway->verifyAuthentication();
        } catch (AgentGatewayException $exception) {
            $this->components->error("Engine check failed [$exception->reason]: {$exception->getMessage()}");

            return self::FAILURE;
        }

        $this->components->info('The engine accepts this application\'s signature and rejects unsigned requests. No run was started.');

        return self::SUCCESS;
    }
}
