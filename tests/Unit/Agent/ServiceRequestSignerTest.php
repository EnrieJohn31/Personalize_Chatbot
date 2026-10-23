<?php

namespace Tests\Unit\Agent;

use App\Services\Ai\ServiceRequestSigner;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class ServiceRequestSignerTest extends TestCase
{
    public function test_signing_matches_the_shared_cross_runtime_vector(): void
    {
        $vector = json_decode((string) file_get_contents(dirname(__DIR__, 3).'/contracts/v1/examples/signature.json'), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame($vector['bodySha256'], hash('sha256', $vector['body']));
        $this->assertSame(
            $vector['canonicalRequest'],
            ServiceRequestSigner::canonicalRequest($vector['timestamp'], $vector['method'], $vector['target'], $vector['body']),
        );
        $this->assertSame(
            $vector['signature'],
            (new ServiceRequestSigner($vector['key']))->signature($vector['timestamp'], $vector['method'], $vector['target'], $vector['body']),
        );
    }

    public function test_any_change_to_a_signed_component_changes_the_signature(): void
    {
        $signer = new ServiceRequestSigner(str_repeat('k', 32));
        $original = $signer->signature('1792713600', 'POST', '/internal/runs', '{}');

        $this->assertNotSame($original, $signer->signature('1792713601', 'POST', '/internal/runs', '{}'));
        $this->assertNotSame($original, $signer->signature('1792713600', 'PUT', '/internal/runs', '{}'));
        $this->assertNotSame($original, $signer->signature('1792713600', 'POST', '/internal/runs/x', '{}'));
        $this->assertNotSame($original, $signer->signature('1792713600', 'POST', '/internal/runs', '{ }'));
        $this->assertNotSame($original, (new ServiceRequestSigner(str_repeat('j', 32)))->signature('1792713600', 'POST', '/internal/runs', '{}'));
    }

    public function test_short_keys_are_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new ServiceRequestSigner(str_repeat('k', ServiceRequestSigner::MIN_KEY_LENGTH - 1));
    }
}
