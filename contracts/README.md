# Private engine contracts

Versioned JSON Schemas (draft 2020-12) for calls between Laravel and the private Node/Pi engine. These files are the runtime source of truth: the engine compiles them directly in `agent-service/src/contracts.ts`. Laravel's `App\Data\Agent\RunRequest` enforces the same bounds before signing, and its tests compare those bounds with the schema.

Introduced by Build Plan task 2.2; the event stream was added in task 2.4 and provider connections in task 3.1. Durable run claims, event callbacks and replay belong to Phases 4–5.

## Version 1

| Request                                       | Body                                              | Success                                                |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `POST /internal/runs`                         | `run-request.schema.json`                         | `202`, `run-acknowledgement.schema.json`               |
| `POST /internal/runs/{runId}/cancel`          | `cancel-request.schema.json`                      | `202`, status `cancel_requested`                       |
| `GET /internal/runs/{runId}/events?after={n}` | None; signed, empty body                          | `200`, NDJSON lines of `run-event.schema.json` (below) |
| `GET /internal/health`                        | None; unsigned readiness only                     | `200`; never makes a model call                        |
| `/internal/connections/{connectionId}…`       | See [provider connections](#provider-connections) | `200`, non-secret sign-in state                        |
| `GET /internal/local-model`                   | None; signed, empty body                          | `200`, `local-model-status.schema.json`                |

Every non-2xx response uses `error.schema.json`. `run-event.schema.json` defines the normalized engine events. The engine streams them from the events endpoint, and Laravel validates each one again (`App\Data\Agent\RunEvent`) before relaying it. Tool and source event types arrive with the first tool in task 3.3.

A `202` means admitted, not completed. The run snapshot is created by Laravel from the acting user's owned history. It carries IDs, the profile/model reference, a non-secret connection reference and limits. It never carries credentials, browser-chosen tools or provider-specific transcript data.

Examples in `v1/examples/` are loaded by both test suites. Keep them valid when a schema changes.

## Request authentication: `AGENT-HMAC-SHA256-V1`

Laravel signs each run/cancel request with `AGENT_REQUEST_SIGNING_KEY`, a shared key of at least 32 characters. It lives only in ignored `.env` files, and Compose passes the same value to the engine. Without a key, the engine keeps run endpoints closed with `503 request_auth_not_configured`, and Laravel refuses to send anything.

```text
X-Agent-Timestamp: <unix seconds>
X-Agent-Signature: v1=<hex HMAC-SHA256(key, canonical request)>

canonical request = AGENT-HMAC-SHA256-V1 \n timestamp \n METHOD \n target \n hex SHA-256(body bytes)
```

- The target is the request path and query exactly as the engine receives them, for example `/internal/runs` or `/internal/runs/{runId}/events?after=0`. The body hash covers the exact bytes sent; a `GET` hashes the empty body.
- The engine accepts timestamps within ±60 seconds and compares signatures in constant time. All failures return the same `401 authentication_failed`; the specific reason is only logged.
- A captured request could be replayed within that window. That is acceptable for v1 because admission and cancellation are idempotent by run ID; there is no nonce store.
- `v1/examples/signature.json` is a fixed test vector, computed independently with OpenSSL and Node and checked by both runtimes.
- Engine-to-Laravel callbacks (tasks 4.2–4.3) must use a separate `AGENT_CALLBACK_SIGNING_KEY` with this scheme. Key rotation with overlapping keys is not implemented.

Network isolation remains required: the engine port is never published, and the signature is an additional control, not a replacement.

## Engine admission order

1. Route match. Unknown routes return `404 not_found`.
2. Signing key configured, then signature headers present, well-formed and fresh. This happens before the body is read.
3. Body read with a 1 MiB limit, then signature verified over the exact bytes.
4. `application/json` content type, strict UTF-8 JSON, `contractVersion` equal to `1`, then the schema.
5. Semantic checks: final message has role `user`, unique message IDs, a verified model provider, and every capability enforceable.
6. Bounded admission record: identical resubmission returns `duplicate: true`; the same run ID with a different payload is rejected.
7. A newly admitted run starts executing immediately, whether or not anyone reads its events. A duplicate admission never starts a second execution.

Until model execution (task 3.2) and the tool registry (task 3.3) exist, the engine admits only the deterministic `simulated` provider. It does that only when `AGENT_SIMULATION_ENABLED=true`, which development Compose sets explicitly. Every capability is refused until tools exist. The admission record is process-local, holds at most 256 runs for 15 minutes and is lost on restart; Laravel's durable claim (task 4.2) becomes the authority.

## Event stream

`GET /internal/runs/{runId}/events?after={n}` first replays the run's retained events with a sequence above `n` (default 0), then follows the run live. It ends after the terminal event (`run.completed`, `run.failed` or `run.cancelled`). The response is `application/x-ndjson`, one event per line. Blank lines are heartbeats, sent every 15 seconds while the run is idle, and readers skip them. Reading never starts, repeats or cancels work. Several readers can follow the same run, and a reader that reconnects with its last sequence receives no duplicates.

Each run keeps at most 2,000 events in engine memory, with the last slot reserved for a terminal event, so an overlong run ends with `run.failed` (`event_limit_exceeded`). Events are lost with the admission record (15 minutes, or an engine restart). Laravel's persisted event store (task 4.3) replaces this for durable replay.

The simulated run is deterministic: the same request always yields the same Markdown answer, which quotes the latest question. It emits `run.started`, `run.progress` (`answering`), `assistant.delta` chunks of about three words, `assistant.final` with the complete text, and `run.completed`. The deltas always add up to the final text. `AGENT_SIMULATION_CHUNK_DELAY_MS` (default 35, maximum 1000) sets the pause between chunks. Cancellation ends the run with `run.cancelled` and no final text; passing the run deadline ends it with `run.failed` (`deadline_exceeded`).

## Provider connections

A connection ID is the UUID of Laravel's `provider_connections` record. Providers are `openai` (ChatGPT, browser sign-in), `opencode-go` and `opencode` (OpenCode Go and Zen, API key), and `local` (the administrator's local model server, no user credential). These endpoints are signed like the run endpoints (a `GET` or `DELETE` hashes the empty body). They return `503 credential_store_not_configured` until the engine has `AGENT_CREDENTIAL_KEY`. They never return or log a credential; only the key endpoint accepts one. See [the connections guide](../docs/connections.md) for the flow and storage.

| Request                                                 | Body                                                   | Success: `200` with                  |
| ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| `GET /internal/connections/{id}?provider={provider}`    | None                                                   | `connection-status.schema.json`      |
| `DELETE /internal/connections/{id}?provider={provider}` | None; removes the stored sign-in or key                | `connection-status.schema.json`      |
| `POST /internal/connections/{id}/login`                 | `connection-login-request.schema.json` (`openai` only) | `connection-login.schema.json`       |
| `GET /internal/connections/{id}/login`                  | None; the connection's latest sign-in                  | `connection-login.schema.json`       |
| `DELETE /internal/connections/{id}/login`               | None; cancels it                                       | `connection-login.schema.json`       |
| `POST /internal/connections/{id}/login/callback`        | `connection-callback-request.schema.json`              | `connection-login.schema.json`       |
| `PUT /internal/connections/{id}/key`                    | `connection-key-request.schema.json` (OpenCode only)   | `connection-status.schema.json`      |
| `POST /internal/connections/{id}/test`                  | `connection-test-request.schema.json`                  | `connection-test-result.schema.json` |

- **Status.** It reads only the engine's encrypted store and never calls the provider. `unreadable` means a stored file cannot be decrypted, for example after the key changed. A new sign-in or key replaces it.
- **Key.** It stores an API key (8–512 printable characters without spaces) for an API-key provider, replacing any earlier one. Different providers of the same connection keep separate credentials.
- **Login states.** A sign-in moves through `starting` → `waiting_for_user` (with `authUrl`, the provider page the user opens) → `exchanging` → `connected`, `failed` or `cancelled`. Starting answers once the sign-in page is known; a pasted redirect or a cancel answers once the outcome is known. Either waits at most about 5 seconds, and the caller polls after that.
    - There is one sign-in at a time because the provider fixes the callback port. Starting again for the same connection returns its pending sign-in; another connection gets `409 login_in_progress`.
    - An unfinished sign-in is cancelled after 10 minutes. Sign-ins in progress are lost on an engine restart; stored credentials are not.
- **Callback.** The pasted redirect must match the pending sign-in's `redirect_uri` and `state` and carry a `code`. Otherwise it is refused with `422 invalid_redirect` and the sign-in keeps waiting. An address that reports `error=` is passed on and ends the sign-in as `failed`.
- **Test.** It sends one short message with the stored credential, so it can count against the user's plan or balance. It refreshes an expiring token first and sends a fresh session ID, which OpenCode requires. Provider problems are a `200` with `outcome: failed` and one of `not_connected`, `reauth_required`, `credentials_unreadable`, `provider_error` or `timeout` (60 seconds). Ambient credentials such as `OPENAI_API_KEY` and `OPENCODE_API_KEY` are never used.
- **Local server.** For `local`, status asks the configured server for its models (cached 15 seconds) instead of reading the store: `connected` with its models, `unreachable` when it does not answer, or `not_connected` when none is configured. Key and sign-in requests are refused as `invalid_payload`, and disconnect stores and removes nothing. A test lists the server's models first, so a model it no longer serves is `unknown_model`.
- **Local model view.** `GET /internal/local-model` answers `configured`, the card `name`, the `baseUrl`, `reachable`, the `models` and the `error` reason. The address comes only from the engine's `LOCAL_LLM_URL`; no request can set it. It never returns `LOCAL_LLM_API_KEY`.

## Error codes

| HTTP | Code                              | Meaning                                                                          | Resubmit same run?     |
| ---- | --------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| 400  | `invalid_json`                    | Body is not UTF-8 JSON                                                           | No                     |
| 401  | `authentication_failed`           | Signature missing, malformed, expired or wrong                                   | No                     |
| 404  | `not_found` / `run_not_found`     | Unknown route, or cancel/events for an untracked run                             | No                     |
| 409  | `conflicting_duplicate`           | Run ID already admitted with a different payload                                 | No                     |
| 413  | `payload_too_large`               | Body over 1 MiB                                                                  | No                     |
| 415  | `unsupported_media_type`          | Not `application/json`                                                           | No                     |
| 422  | `unsupported_contract_version`    | `contractVersion` is not 1                                                       | No                     |
| 422  | `invalid_payload`                 | Schema or semantic violation, or a bad `after` cursor; `details` lists ≤10 paths | No                     |
| 422  | `run_id_mismatch`                 | Cancel body and path run IDs differ                                              | No                     |
| 422  | `model_unavailable`               | Provider not verified, or simulation disabled                                    | No                     |
| 422  | `unsupported_capability`          | The engine cannot enforce a requested capability                                 | No                     |
| 503  | `request_auth_not_configured`     | Engine has no signing key                                                        | After configuration    |
| 503  | `capacity_exhausted`              | Admission record is full                                                         | Yes, later             |
| 500  | `internal_error`                  | Unexpected engine failure                                                        | Investigate first      |
| 404  | `no_login`                        | Connections: no sign-in is held for this connection                              | Start a sign-in        |
| 409  | `login_in_progress`               | Connections: another connection's sign-in holds the callback port                | Later                  |
| 409  | `login_not_waiting`               | Connections: a redirect was pasted after the sign-in moved on                    | No                     |
| 422  | `invalid_redirect`                | Connections: the pasted address does not belong to the pending sign-in           | With the right address |
| 422  | `unknown_model`                   | Connections: the test model is not in the engine's catalog                       | No                     |
| 422  | `unsupported_auth_method`         | Connections: a key for a sign-in provider, or a sign-in for a key provider       | No                     |
| 503  | `credential_store_not_configured` | Connections: engine has no `AGENT_CREDENTIAL_KEY`                                | After configuration    |

`App\Services\Ai\AgentGatewayException` exposes these codes as `reason`. It adds four Laravel-side reasons: `not_configured` (missing or short key; nothing sent), `unavailable` (connection failure, timeout or a bare 5xx; retryable), `stream_interrupted` (an event stream ended or stalled before its terminal event; read again to resume) and `invalid_response` (anything outside this contract, including another contract version or an out-of-order event). For an engine rejection, `engineMessage` keeps the engine's own message; the settings page shows it for `invalid_redirect`.

Health's `providerAuth` reports `configured` once the engine has a credential key, which means sign-in endpoints are open. It does not mean any account is connected.

## Changing a contract

- Every schema sets `additionalProperties: false`, so both sides reject unknown fields. Any field change therefore updates the schema, both runtimes, the examples and their tests in one commit. The repository releases both runtimes together.
- A change that an older runtime could not process becomes `contracts/v2/` with a new `contractVersion`. Do not reinterpret a v1 field.
- Bounds such as message counts and lengths are duplicated as constants in `RunRequest`; `tests/Unit/Agent/RunRequestTest.php` fails if they drift.

## Checks

```powershell
docker compose exec agent npm test                                   # schemas, signing, admission
docker compose exec --user sail laravel.test php artisan test --filter=Agent
docker compose exec --user sail laravel.test php artisan agent:check # live keys and reachability
```

`agent:check` reports engine health, sends one signed but deliberately incomplete request (expects `422 invalid_payload`) and one unsigned request (expects `401`). It admits nothing.
