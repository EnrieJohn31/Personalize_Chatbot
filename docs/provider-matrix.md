# Provider choice and verification

Recorded: 22 October 2026 (Asia/Shanghai), Build Plan task 0.3. Updated 24 October 2026 for task 3.1, the OpenCode connections and the local model server.

Status: **ChatGPT sign-in, OpenCode keys, the local model server and the credential store are implemented; no live sign-in, key or local server has been used yet.** No real credential has been requested, read, copied or created. Every check so far used fakes or invented credentials on a network without internet access. Chat replies still use the simulation until task 3.2.

## Shared

| Field | Current state |
| --- | --- |
| Pi packages | `@earendil-works/pi-ai@1.4.0`, `@earendil-works/pi-agent-core@1.4.0` |
| Runtime | Node `24.22.1`, inside the private agent container |
| Connection owner | Each Laravel user connects their own accounts on the Connections page; one connection record per user and provider |
| Credential persistence | Implemented: one AES-256-GCM file per connection in the private `agent-data` volume, keyed from `AGENT_CREDENTIAL_KEY`, authenticated with the connection ID, with serialized atomic writes. Verified with fakes and invented credentials |
| Not used | Pi's legacy `openai-codex` provider, which reuses the Codex CLI's OAuth client. `OPENAI_API_KEY` and `OPENCODE_API_KEY` are also never used: the engine's auth context hides environment variables and files, so there is no silent API billing |
| Streaming / tool calling / Stop / budgets | Not implemented for live models (tasks 3.2–3.5) |

## ChatGPT (`openai`)

| Field | Current state |
| --- | --- |
| Path | Pi's OpenAI provider with OpenAI's "Sign in with ChatGPT" for agents. It uses dynamic client registration (`client_id=dynamic_agent_client`), PKCE and the redirect `http://127.0.0.1:1455/auth/callback`. Requested scope: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Requests go to the Responses API at `api.openai.com/v1` with the user's access token. |
| Agent identity sent to OpenAI | `APP_NAME` as the consent-screen name, and a stable installation UUID (`/var/lib/agent/installation-id`) as the agent host ID |
| Model catalog | Pi 1.4.0 lists 42 OpenAI chat models; the default test model is `gpt-5.4-mini` (`ASSISTANT_CONNECTION_TEST_MODEL`). Which models a plan may call is decided by OpenAI: **unverified** |
| Account eligibility | Decided by OpenAI during sign-in (for example Plus or Pro): **unverified** |
| Login | Implemented: the browser callback through the loopback-published port 1455, or a pasted redirect address, one sign-in at a time with a 10-minute limit. Verified up to the real OpenAI sign-in address and the engine's callback listener, also from the Windows host; **completing it with a real account is untested** |
| Refresh | Implemented by Pi under the vault lock when less than five minutes remain. Verified with a fake provider; **the real token lifetime and refresh are untested** |
| Re-authentication | A failed refresh reports `reauth_required` and marks the record; an unreadable file reports "connect again". Verified with fakes; **untested against OpenAI** |
| Last live test | None. On 24 October 2026 the operator's record was still `not_configured`. Next: sign in on the Connections page and send a test message |

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

After the operator's live check, record here: the date, whether the sign-in or key worked, the test model and its reply or error, and for ChatGPT the access token lifetime (from the status `expiresAt`) and whether a test after expiry refreshed silently. Do not record tokens, keys, account e-mail addresses or screenshots of consent pages with personal data.

Pi 1.4.0's [provider documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md) describes the older Codex provider as legacy. Do not copy a host application's credentials, assume subscription eligibility, or silently fall back to paid API-key usage. See [the connections guide](connections.md) for the flow, storage and limits.
