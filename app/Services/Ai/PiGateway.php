<?php

namespace App\Services\Ai;

use App\Contracts\AgentGateway;
use App\Data\Agent\RunAcknowledgement;
use App\Data\Agent\RunEvent;
use App\Data\Agent\RunRequest;
use Generator;
use Illuminate\Container\Attributes\Config;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use InvalidArgumentException;
use JsonException;
use RuntimeException;
use SensitiveParameter;

/**
 * Signed HTTP client for the private Node/Pi engine. It hands work over and reports the
 * engine's answer; it never runs a model loop and never retries on its own, so the caller
 * decides whether to resubmit the same run ID.
 */
final class PiGateway implements AgentGateway
{
    /** An event line is far smaller; anything longer is not a contract event. */
    private const MAX_EVENT_LINE_BYTES = 1_048_576;

    public function __construct(
        #[Config('assistant.agent_url')] private readonly string $baseUrl,
        #[Config('assistant.agent_request_signing_key'), SensitiveParameter] private readonly ?string $signingKey,
        #[Config('assistant.agent_connect_timeout_seconds')] private readonly float $connectTimeout,
        #[Config('assistant.agent_timeout_seconds')] private readonly float $timeout,
        #[Config('assistant.agent_stream_timeout_seconds')] private readonly float $streamTimeout = 240,
        #[Config('assistant.agent_stream_read_timeout_seconds')] private readonly float $streamReadTimeout = 30,
    ) {}

    public function submit(RunRequest $request): RunAcknowledgement
    {
        $response = $this->send('POST', '/internal/runs', $request->toJson());

        return $this->acknowledgement($response, $request->runId, ['accepted', 'cancel_requested']);
    }

    public function cancel(string $runId): RunAcknowledgement
    {
        if (! RunRequest::isUuid($runId)) {
            throw new InvalidArgumentException('Run IDs must be lowercase UUIDs.');
        }

        $body = json_encode(['contractVersion' => RunRequest::CONTRACT_VERSION, 'runId' => $runId], JSON_THROW_ON_ERROR);

        return $this->acknowledgement($this->send('POST', "/internal/runs/$runId/cancel", $body), $runId, ['cancel_requested']);
    }

    /** @return Generator<int, RunEvent> */
    public function events(string $runId, int $after = 0): Generator
    {
        if (! RunRequest::isUuid($runId) || $after < 0) {
            throw new InvalidArgumentException('Event streams need a lowercase run UUID and a non-negative cursor.');
        }

        $response = $this->send('GET', "/internal/runs/$runId/events?after=$after", null, stream: true);
        if ($response->status() !== 200) {
            throw $this->failure($response);
        }

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        $previous = $after;

        try {
            while (! $body->eof()) {
                $buffer .= $body->read(8192);

                while (($end = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $end));
                    $buffer = substr($buffer, $end + 1);

                    // Blank lines are the engine's heartbeat.
                    if ($line === '') {
                        continue;
                    }

                    $event = RunEvent::fromPayload(json_decode($line, true, 64, JSON_THROW_ON_ERROR), $runId, $previous)
                        ?? throw AgentGatewayException::invalidResponse(200, 'an event is malformed or out of order.');
                    $previous = $event->sequence;

                    yield $event;

                    if ($event->isTerminal()) {
                        return;
                    }
                }

                if (strlen($buffer) > self::MAX_EVENT_LINE_BYTES) {
                    throw AgentGatewayException::invalidResponse(200, 'an event line exceeds the size limit.');
                }
            }
        } catch (JsonException) {
            throw AgentGatewayException::invalidResponse(200, 'an event line is not JSON.');
        } catch (AgentGatewayException $exception) {
            throw $exception;
        } catch (RuntimeException $exception) {
            // Read timeouts and dropped connections surface from the PSR stream.
            throw AgentGatewayException::streamInterrupted($exception);
        }

        throw AgentGatewayException::streamInterrupted();
    }

    public function health(): array
    {
        try {
            $response = $this->client()->get($this->url('/internal/health'));
        } catch (ConnectionException $exception) {
            throw AgentGatewayException::unavailable($exception);
        }

        $payload = $response->json();
        if (! $response->ok() || ! is_array($payload) || ($payload['status'] ?? null) !== 'ok') {
            throw AgentGatewayException::invalidResponse($response->status(), 'health did not report status ok.');
        }

        $field = fn (string $key): string => is_string($payload[$key] ?? null) ? $payload[$key] : 'unknown';

        return [
            'status' => 'ok',
            'providerAuth' => $field('providerAuth'),
            'requestAuth' => $field('requestAuth'),
            'simulation' => $field('simulation'),
        ];
    }

    /**
     * Operator diagnostic: proves the engine accepts this application's signature and rejects
     * unsigned requests. The probe payload is deliberately incomplete, so it admits nothing.
     *
     * @throws AgentGatewayException
     */
    public function verifyAuthentication(): void
    {
        $signed = $this->send('POST', '/internal/runs', '{"contractVersion":1}');
        if ($signed->status() !== 422 || $signed->json('error.code') !== 'invalid_payload') {
            throw $this->failure($signed);
        }

        try {
            $unsigned = $this->client()->withBody('{"contractVersion":1}', 'application/json')->post($this->url('/internal/runs'));
        } catch (ConnectionException $exception) {
            throw AgentGatewayException::unavailable($exception);
        }
        if ($unsigned->status() !== 401) {
            throw AgentGatewayException::invalidResponse($unsigned->status(), 'an unsigned request was not rejected.');
        }
    }

    /** Signs the exact request target (path and query) and body bytes; a null body sends none. */
    private function send(string $method, string $path, ?string $body, bool $stream = false): Response
    {
        if ($this->signingKey === null || strlen($this->signingKey) < ServiceRequestSigner::MIN_KEY_LENGTH) {
            throw AgentGatewayException::notConfigured();
        }

        $url = $this->url($path);
        $query = parse_url($url, PHP_URL_QUERY);
        $target = parse_url($url, PHP_URL_PATH).(is_string($query) ? "?$query" : '');
        $headers = (new ServiceRequestSigner($this->signingKey))->headers($method, (string) $target, $body ?? '', now()->getTimestamp());

        $request = ($stream ? $this->streamClient() : $this->client())->withHeaders($headers);
        if ($body !== null) {
            $request = $request->withBody($body, 'application/json');
        }

        try {
            return $request->send($method, $url);
        } catch (ConnectionException $exception) {
            throw AgentGatewayException::unavailable($exception);
        }
    }

    /** @param  list<string>  $expectedStatuses */
    private function acknowledgement(Response $response, string $runId, array $expectedStatuses): RunAcknowledgement
    {
        if ($response->status() !== 202) {
            throw $this->failure($response);
        }

        return RunAcknowledgement::fromPayload($response->json(), $runId, $expectedStatuses)
            ?? throw AgentGatewayException::invalidResponse(202, 'unexpected fields, contract version, run ID or status.');
    }

    private function failure(Response $response): AgentGatewayException
    {
        $error = $response->json('error');
        if (is_array($error) && is_string($error['code'] ?? null) && is_string($error['message'] ?? null)) {
            return AgentGatewayException::rejected(
                $response->status(),
                Str::limit($error['code'], 64, ''),
                Str::limit($error['message'], 500),
                $this->details($error['details'] ?? []),
            );
        }

        // A bare 5xx (for example from a proxy) means the engine was not reachable as itself.
        return $response->serverError()
            ? AgentGatewayException::unavailable($response->toException(), $response->status())
            : AgentGatewayException::invalidResponse($response->status(), 'missing error envelope.');
    }

    /** @return list<array{path: string, message: string}> */
    private function details(mixed $details): array
    {
        $parsed = [];
        foreach (is_array($details) ? array_slice($details, 0, 20) : [] as $detail) {
            if (is_array($detail) && is_string($detail['path'] ?? null) && is_string($detail['message'] ?? null)) {
                $parsed[] = ['path' => Str::limit($detail['path'], 500), 'message' => Str::limit($detail['message'], 500)];
            }
        }

        return $parsed;
    }

    private function client(): PendingRequest
    {
        return Http::acceptJson()->connectTimeout($this->connectTimeout)->timeout($this->timeout);
    }

    private function streamClient(): PendingRequest
    {
        return Http::accept('application/x-ndjson')
            ->connectTimeout($this->connectTimeout)
            ->timeout($this->streamTimeout)
            ->withOptions(['stream' => true, 'read_timeout' => $this->streamReadTimeout]);
    }

    private function url(string $path): string
    {
        return rtrim($this->baseUrl, '/').$path;
    }
}
