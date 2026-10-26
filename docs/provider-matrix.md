# Provider choice and verification

Recorded: 22 October 2026 (Asia/Shanghai), Build Plan task 0.3. Updated 26 October 2026: real refusal reason and diagnostic review recorded after the earlier refresh/Stop acceptance.

Status: **Task 3.1 is complete for the chosen ChatGPT connection.** Sign-in, real replies and persistence across an engine restart were verified on 24 October; automatic renewal after an observed expiry passed on 25 October with `gpt-6-luna`. OpenCode keys and the local model server have not been used live yet. No credential was copied, printed or recorded; the checks read only non-secret status and answers.

## Shared

| Field | Current state |
| --- | --- |
| Pi packages | `@earendil-works/pi-ai@1.4.0`, `@earendil-works/pi-agent-core@1.4.0` |
| Runtime | Node `24.22.1`, inside the private agent container |
| Connection owner | Each Laravel user connects their own accounts on the Connections page; one connection record per user and provider |
| Credential persistence | Implemented: one AES-256-GCM file per connection in the private `agent-data` volume, keyed from `AGENT_CREDENTIAL_KEY`, authenticated with the connection ID, with serialized atomic writes. Storage safeguards verified with fakes; the real ChatGPT sign-in survived engine restarts, and the status endpoint read the renewed expiry from the vault after the 25 October test |
| Not used | Pi's legacy `openai-codex` provider, which reuses the Codex CLI's OAuth client. `OPENAI_API_KEY` and `OPENCODE_API_KEY` are also never used: the engine's auth context hides environment variables and files, so there is no silent API billing |
| Streaming | Implemented (task 3.2): a fresh Pi Agent per run on the run's own connection, with batched deltas, honest failure codes and Stop. Verified live with ChatGPT (below) and with Pi's faux provider |
| Tool calling | Implemented (task 3.3): `lookup_reference` through the engine's tool executor, with the run's tool and round budgets. Verified with Pi's faux provider; live result below. See [tools](tools.md) |
| Context / output budgets | Model-aware context/token budgets remain task 3.4. Per-request output tokens, aggregate reply characters, model rounds and tool calls already have hard ceilings |
| Stop | Task 3.5: cancellation checked before model/tool work, combined run/tool signals and cancelled tool outcome. Active-tool behavior verified with a controlled slow tool; real browser result below. See [Stop](stop.md) |

## ChatGPT (`openai`)

| Field | Current state |
| --- | --- |
| Path | Pi's OpenAI provider with OpenAI's "Sign in with ChatGPT" for agents. It uses dynamic client registration (`client_id=dynamic_agent_client`), PKCE and the redirect `http://127.0.0.1:1455/auth/callback`. Requested scope: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Requests go to the Responses API at `api.openai.com/v1` with the user's access token. |
| Agent identity sent to OpenAI | `APP_NAME` as the consent-screen name, and a stable installation UUID (`/var/lib/agent/installation-id`) as the agent host ID |
| Model catalog | Pi 1.4.0 lists 42 OpenAI chat models; the default test model is `gpt-5.4-mini` (`ASSISTANT_CONNECTION_TEST_MODEL`). `gpt-6-luna` works on the operator's chosen connection; access to other listed models is unverified |
| Account eligibility | The operator's existing connection successfully signs in, refreshes and calls `gpt-6-luna`. Plan tier, other accounts and other models were not checked |
| Login | Implemented: the browser callback through the loopback-published port 1455, or a pasted redirect address, one sign-in at a time with a 10-minute limit. **Completed with the operator's real account on 24 October 2026.** It first failed with "fetch failed": host security software (Kaspersky's encrypted-connection scanning) re-signed `chatgpt.com` and sometimes `auth.openai.com`, and the engine rejected that certificate. It worked once scanning was paused. See the connections guide's limits |
| Refresh | **Passed live on 25 October 2026.** Before the test, status reported expiry at 24 October 19:12:14 +08:00. At 25 October 18:56:13 +08:00 the same connection sent a short test through Laravel, without a new sign-in. `gpt-6-luna` replied `Connected` in 7,155 ms. Status then reported expiry at 25 October 19:53:16 +08:00, with 3,415 seconds remaining when checked at 18:56:21. Both engine and Laravel stayed `connected`. This measures remaining validity after renewal, not the full issuance lifetime |
| Re-authentication | **Real refusal recorded on 26 October:** HTTP 400 `invalid_grant`, reason `refresh_token_invalidated`; the provider invalidated the grant, with its underlying reason unknown. The earlier HTTPS-scanning hypothesis did not explain this refusal. A new sign-in is needed for that grant; successful sign-in after the refusal has not been recorded. The engine persists the reason/time across restarts and the Connections card displays a safe explanation. Transient renewal failures remain retryable. Fake tests cover new sign-in clearing the refusal; no new live request was made during publication review |
| Earlier live reply/tool tests | 24 October 2026, task 3.2: two runs on `gpt-6-luna` with reasoning `medium`, submitted and read through Laravel's signed gateway on the operator's connection. "What is 17 times 3?" answered "17 times 3 is 51." in 6.0 s (first text at 5.6 s). A five-item Markdown list streamed in 10 pieces between 2.7 s and 4.2 s. No chat rows were written. Persistence across an engine restart: the engine was rebuilt and restarted before these runs, and the stored sign-in still worked. Task 3.3, same day and setup: `gpt-6-luna` called `lookup_reference` itself and answered the sample warehouse's code and delivery hours from the invented record in 8.9 s; with no tools permitted it said it lacked the details. The engine was rebuilt again before these runs, and the sign-in still worked |

Task 3.5 live Stop, 25 October 2026: Chromium on the existing `openai` / `gpt-6-luna` connection completed one lookup, then Stop during streamed text reached browser `run.cancelled` in **5,655 ms**. The HTTP `202` took **5,850 ms**; 38 additional chunks arrived while Stop was pending. No final answer was saved, reload offered another reply and no page error occurred. The check used an isolated application database with the existing connection reference; credentials stayed in the engine. This is end-to-end local cancellation latency, not proof of immediate remote computation/billing cessation. [Validation](validation.md) records the controlled active-tool case and transport limits.

## OpenCode Go (`opencode-go`) and OpenCode Zen (`opencode`)

| Field | Current state |
| --- | --- |
| Path | Pi's OpenCode providers with an API key the user creates at opencode.ai/auth. The same key serves Go (subscription) and Zen (pay as you go). Each request carries an `x-opencode-session` header. |
| Model catalog | Pi 1.4.0 lists 29 Go and 83 Zen models. Both default test models are the free `beam-free` (`ASSISTANT_OPENCODE_GO_TEST_MODEL`, `ASSISTANT_OPENCODE_ZEN_TEST_MODEL`). Which models an account may call is decided by OpenCode: **unverified** |
| Key handling | Implemented: the key crosses browser → Laravel → engine once and is stored encrypted. It is never returned, logged, kept by Laravel or flashed as old input. Verified with fakes and an invented key, including that the probe page never contained it |
| Last live test | None. Next: paste a real key and send a test message on the free model |

## Local model server (`local`)

| Field | Current state |
| --- | --- |
| Path | An administrator-configured OpenAI-compatible server (`LOCAL_LLM_URL`): Ollama, LM Studio, llama.cpp or vLLM. Pi's `openai-completions` API with streaming, a system message instead of the developer role, and no reasoning effort. No user credential; an optional `LOCAL_LLM_API_KEY` is sent as a bearer token, otherwise the placeholder `unused` |
| Model catalog | Whatever the server lists at `GET /v1/models`, up to 200 IDs, cached for 15 seconds. Context window and output limit are assumed (32,768 and 8,192 tokens) |
| Billing | None per message; the server's own hardware |
| Last live test | None with a real server. Verified with a fake OpenAI-compatible server on an internal network: listing, a streamed test message, choosing it for chat, the server stopping and recovering, and no server configured. Next: point `LOCAL_LLM_URL` at a running Ollama or LM Studio and send a test message |

For subsequent provider checks, record the date, sign-in/key outcome, model and reply or error, and the observed expiry before and after renewal. Task 3.1's chosen connection has passed; rejection/re-authentication is tested with fakes, without deliberately revoking the operator's live sign-in. Do not record tokens, keys, account e-mail addresses or screenshots of consent pages with personal data.

Pi 1.4.0's [provider documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md) describes the older Codex provider as legacy. Do not copy a host application's credentials, assume subscription eligibility, or silently fall back to paid API-key usage. See [the connections guide](connections.md) for the flow, storage and limits.
