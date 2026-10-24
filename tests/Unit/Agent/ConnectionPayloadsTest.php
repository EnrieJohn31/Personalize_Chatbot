<?php

namespace Tests\Unit\Agent;

use App\Data\Agent\ConnectionStatus;
use App\Data\Agent\ConnectionTestResult;
use App\Data\Agent\LocalModelStatus;
use App\Data\Agent\LoginState;
use Closure;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ConnectionPayloadsTest extends TestCase
{
    private const CONNECTION_ID = '0199f2a1-3d4e-7f50-8162-738495a6b7c8';

    public function test_the_shared_examples_parse(): void
    {
        $status = ConnectionStatus::fromPayload(self::example('connection-status.json'), self::CONNECTION_ID, 'openai');
        $this->assertNotNull($status);
        $this->assertTrue($status->isConnected());
        $this->assertSame(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'], $status->models);
        $this->assertSame(1_792_774_800_000, $status->expiresAt);

        $login = LoginState::fromPayload(self::example('connection-login.json'), self::CONNECTION_ID, 'openai');
        $this->assertNotNull($login);
        $this->assertTrue($login->isActive());
        $this->assertStringStartsWith('https://auth.openai.com/', (string) $login->authUrl);

        $result = ConnectionTestResult::fromPayload(self::example('connection-test-result.json'), self::CONNECTION_ID, 'openai', 'gpt-5.4-mini');
        $this->assertNotNull($result);
        $this->assertSame([true, 'Connected', null], [$result->ok, $result->reply, $result->errorCode]);
    }

    public function test_a_failed_test_result_carries_its_code_and_message(): void
    {
        $payload = [...self::example('connection-test-result.json'), 'outcome' => 'failed', 'reply' => null,
            'error' => ['code' => 'reauth_required', 'message' => 'The sign-in has expired or was revoked. Sign in again.']];

        $result = ConnectionTestResult::fromPayload($payload, self::CONNECTION_ID, 'openai', 'gpt-5.4-mini');

        $this->assertNotNull($result);
        $this->assertFalse($result->ok);
        $this->assertSame('reauth_required', $result->errorCode);
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidStatuses')]
    public function test_statuses_outside_the_contract_are_rejected(Closure $change): void
    {
        $this->assertNull(ConnectionStatus::fromPayload($change(self::example('connection-status.json')), self::CONNECTION_ID, 'openai'));
    }

    /** @return array<string, array{Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidStatuses(): array
    {
        return [
            'credential field' => [fn (array $p): array => [...$p, 'access' => 'token']],
            'another connection' => [fn (array $p): array => [...$p, 'connectionId' => '0199f2a1-3d4e-7f50-8162-000000000000']],
            'another provider' => [fn (array $p): array => [...$p, 'provider' => 'anthropic']],
            'unknown status' => [fn (array $p): array => [...$p, 'status' => 'expired']],
            'newer contract' => [fn (array $p): array => [...$p, 'contractVersion' => 2]],
            'string expiry' => [fn (array $p): array => [...$p, 'expiresAt' => '1792774800000']],
            'malformed model' => [fn (array $p): array => [...$p, 'models' => ['gpt 5']]],
            'model map' => [fn (array $p): array => [...$p, 'models' => ['a' => 'gpt-5.4']]],
        ];
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidLogins')]
    public function test_sign_in_states_outside_the_contract_are_rejected(Closure $change): void
    {
        $this->assertNull(LoginState::fromPayload($change(self::example('connection-login.json')), self::CONNECTION_ID, 'openai'));
    }

    /** @return array<string, array{Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidLogins(): array
    {
        return [
            'insecure sign-in page' => [fn (array $p): array => [...$p, 'authUrl' => 'http://auth.example.test/authorize']],
            'waiting without a page' => [fn (array $p): array => [...$p, 'authUrl' => null]],
            'page after waiting' => [fn (array $p): array => [...$p, 'state' => 'connected']],
            'unknown state' => [fn (array $p): array => [...$p, 'state' => 'done', 'authUrl' => null]],
            'overlong error' => [fn (array $p): array => [...$p, 'error' => str_repeat('x', 501)]],
            'missing expiry' => [fn (array $p): array => array_diff_key($p, ['expiresAt' => true])],
        ];
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidResults')]
    public function test_test_results_outside_the_contract_are_rejected(Closure $change): void
    {
        $this->assertNull(ConnectionTestResult::fromPayload($change(self::example('connection-test-result.json')), self::CONNECTION_ID, 'openai', 'gpt-5.4-mini'));
    }

    /** @return array<string, array{Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidResults(): array
    {
        $failure = ['code' => 'timeout', 'message' => 'Slow.'];

        return [
            'ok with an error' => [fn (array $p): array => [...$p, 'error' => $failure]],
            'failed without an error' => [fn (array $p): array => [...$p, 'outcome' => 'failed', 'reply' => null]],
            'failed with a reply' => [fn (array $p): array => [...$p, 'outcome' => 'failed', 'error' => $failure]],
            'unknown failure code' => [fn (array $p): array => [...$p, 'outcome' => 'failed', 'reply' => null, 'error' => [...$failure, 'code' => 'raw']]],
            'extra error field' => [fn (array $p): array => [...$p, 'outcome' => 'failed', 'reply' => null, 'error' => [...$failure, 'raw' => 'x']]],
            'another model' => [fn (array $p): array => [...$p, 'modelId' => 'gpt-5.5']],
            'negative latency' => [fn (array $p): array => [...$p, 'latencyMs' => -1]],
        ];
    }

    public function test_local_model_statuses_parse_whether_or_not_a_server_is_set_up(): void
    {
        $local = LocalModelStatus::fromPayload(self::example('local-model-status.json'));
        $this->assertNotNull($local);
        $this->assertSame(['Ollama on this PC', ['llama3.2:latest', 'qwen2.5:7b'], null], [$local->name, $local->models, $local->error]);

        $none = LocalModelStatus::fromPayload(['contractVersion' => 1, 'configured' => false, 'name' => null, 'baseUrl' => null, 'reachable' => false, 'models' => [], 'error' => null]);
        $this->assertNotNull($none);
        $this->assertFalse($none->configured);
    }

    /** @param  Closure(array<string, mixed>): array<string, mixed>  $change */
    #[DataProvider('invalidLocalModels')]
    public function test_local_model_statuses_outside_the_contract_are_rejected(Closure $change): void
    {
        $this->assertNull(LocalModelStatus::fromPayload($change(self::example('local-model-status.json'))));
    }

    /** @return array<string, array{Closure(array<string, mixed>): array<string, mixed>}> */
    public static function invalidLocalModels(): array
    {
        return [
            'api key field' => [fn (array $p): array => [...$p, 'apiKey' => 'secret']],
            'other scheme' => [fn (array $p): array => [...$p, 'baseUrl' => 'file:///etc/passwd']],
            'string flag' => [fn (array $p): array => [...$p, 'reachable' => 'yes']],
            'malformed model' => [fn (array $p): array => [...$p, 'models' => ['llama 3']]],
            'too many models' => [fn (array $p): array => [...$p, 'models' => array_map(fn (int $i): string => "model-$i", range(1, 201))]],
            'overlong error' => [fn (array $p): array => [...$p, 'error' => str_repeat('x', 501)]],
            'newer contract' => [fn (array $p): array => [...$p, 'contractVersion' => 2]],
        ];
    }

    /** @return array<string, mixed> */
    private static function example(string $file): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 3)."/contracts/v1/examples/$file"), true, flags: JSON_THROW_ON_ERROR);
    }
}
