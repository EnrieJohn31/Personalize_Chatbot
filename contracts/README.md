# Private engine contracts

Versioned JSON Schemas (draft 2020-12) for calls between Laravel and the private Node/Pi engine. These files are the runtime source of truth: the engine compiles them directly in `agent-service/src/contracts.ts`. Laravel's `App\Data\Agent\RunRequest` enforces the same bounds before signing, and its tests compare those bounds with the schema.

Introduced by Build Plan task 2.2. Durable run claims, event callbacks and replay belong to Phases 4–5.

## Version 1

| Request                              | Body                          | Success                                  |
| ------------------------------------ | ----------------------------- | ---------------------------------------- |
| `POST /internal/runs`                | `run-request.schema.json`     | `202`, `run-acknowledgement.schema.json` |
| `POST /internal/runs/{runId}/cancel` | `cancel-request.schema.json`  | `202`, status `cancel_requested`         |
| `GET /internal/health`               | None; unsigned readiness only | `200`; never makes a model call          |

Every non-2xx response uses `error.schema.json`. `run-event.schema.json` defines the normalized engine events used by the simulated stream (task 2.4) and the later Laravel callbacks; nothing emits them yet. Tool and source event types arrive with the first tool in task 3.3.

A `202` means admitted, not completed. The run snapshot is created by Laravel from the acting user's owned history. It carries IDs, the profile/model reference, a non-secret connection reference and limits. It never carries credentials, browser-chosen tools or provider-specific transcript data.

Examples in `v1/examples/` are loaded by both test suites. Keep them valid when a schema changes.

## Request authentication: `AGENT-HMAC-SHA256-V1`

Laravel signs each run/cancel request with `AGENT_REQUEST_SIGNING_KEY`, a shared key of at least 32 characters. It lives only in ignored `.env` files, and Compose passes the same value to the engine. Without a key, the engine keeps run endpoints closed with `503 request_auth_not_configured`, and Laravel refuses to send anything.

```text
X-Agent-Timestamp: <unix seconds>
X-Agent-Signature: v1=<hex HMAC-SHA256(key, canonical request)>

canonical request = AGENT-HMAC-SHA256-V1 \n timestamp \n METHOD \n path \n hex SHA-256(body bytes)
```

- The path is the request target exactly as the engine receives it, for example `/internal/runs`. The body hash covers the exact bytes sent.
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

Until provider login (task 3.1) and the tool registry (task 3.3) exist, the engine admits only the deterministic `simulated` provider. It does that only when `AGENT_SIMULATION_ENABLED=true`, which development Compose sets explicitly. Every capability is refused until tools exist. The admission record is process-local, holds at most 256 runs for 15 minutes and is lost on restart; Laravel's durable claim (task 4.2) becomes the authority.

## Error codes

| HTTP | Code                           | Meaning                                                       | Resubmit same run?  |
| ---- | ------------------------------ | ------------------------------------------------------------- | ------------------- |
| 400  | `invalid_json`                 | Body is not UTF-8 JSON                                        | No                  |
| 401  | `authentication_failed`        | Signature missing, malformed, expired or wrong                | No                  |
| 404  | `not_found` / `run_not_found`  | Unknown route, or cancel for a run the engine is not tracking | No                  |
| 409  | `conflicting_duplicate`        | Run ID already admitted with a different payload              | No                  |
| 413  | `payload_too_large`            | Body over 1 MiB                                               | No                  |
| 415  | `unsupported_media_type`       | Not `application/json`                                        | No                  |
| 422  | `unsupported_contract_version` | `contractVersion` is not 1                                    | No                  |
| 422  | `invalid_payload`              | Schema or semantic violation; `details` lists ≤10 paths       | No                  |
| 422  | `run_id_mismatch`              | Cancel body and path run IDs differ                           | No                  |
| 422  | `model_unavailable`            | Provider not verified, or simulation disabled                 | No                  |
| 422  | `unsupported_capability`       | The engine cannot enforce a requested capability              | No                  |
| 503  | `request_auth_not_configured`  | Engine has no signing key                                     | After configuration |
| 503  | `capacity_exhausted`           | Admission record is full                                      | Yes, later          |
| 500  | `internal_error`               | Unexpected engine failure                                     | Investigate first   |

`App\Services\Ai\AgentGatewayException` exposes these codes as `reason`. It adds three Laravel-side reasons: `not_configured` (missing or short key; nothing sent), `unavailable` (connection failure, timeout or a bare 5xx; retryable) and `invalid_response` (anything outside this contract, including another contract version).

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
