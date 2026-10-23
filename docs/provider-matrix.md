# Provider choice and verification

Recorded: 22 October 2026 (Asia/Shanghai), Build Plan task 0.3. Updated 24 October 2026 for task 3.1.

Status: **sign-in and credential store implemented; live sign-in with a real account not yet performed.** No real credential has been requested, read, copied or created. Every check so far used fakes or an invented credential on a network without internet access. Chat replies still use the simulation until task 3.2.

| Field | Current state |
| --- | --- |
| Path | Pi's OpenAI provider (`openai`) with OpenAI's "Sign in with ChatGPT" for agents. It uses dynamic client registration (`client_id=dynamic_agent_client`), PKCE and the redirect `http://127.0.0.1:1455/auth/callback`. Requested scope: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Requests go to the Responses API at `api.openai.com/v1` with the user's access token. |
| Not used | Pi's legacy `openai-codex` provider, which reuses the Codex CLI's OAuth client, and any `OPENAI_API_KEY`. The engine's auth context hides environment variables and files, so there is no silent API billing. |
| Pi packages | `@earendil-works/pi-ai@1.4.0`, `@earendil-works/pi-agent-core@1.4.0` |
| Runtime | Node `24.22.1`, inside the private agent container |
| Connection owner | Each Laravel user signs in their own account under Settings → Connections; one `openai`/`oauth` connection record per user |
| Agent identity sent to OpenAI | `APP_NAME` as the consent-screen name, and a stable installation UUID (`/var/lib/agent/installation-id`) as the agent host ID |
| Model catalog | Pi 1.4.0 lists 42 OpenAI chat models; the default test model is `gpt-5.4-mini` (`ASSISTANT_CONNECTION_TEST_MODEL`). Which models a plan may call is decided by OpenAI: **unverified** |
| Account eligibility | Decided by OpenAI during sign-in (for example Plus or Pro): **unverified** |
| Credential persistence | Implemented: one AES-256-GCM file per connection in the private `agent-data` volume, keyed from `AGENT_CREDENTIAL_KEY`, authenticated with the connection ID, with serialized atomic writes. Verified with fakes and an invented credential |
| Login | Implemented: the browser callback through the loopback-published port 1455, or a pasted redirect address, one sign-in at a time with a 10-minute limit. Verified up to the real OpenAI sign-in address and the engine's callback listener; **completing it with a real account is untested** |
| Refresh | Implemented by Pi under the vault lock when less than five minutes remain. Verified with a fake provider; **the real token lifetime and refresh are untested** |
| Re-authentication | A failed refresh reports `reauth_required` and marks the record; an unreadable file reports "sign in again". Verified with fakes; **untested against OpenAI** |
| Streaming / tool calling / Stop / budgets | Not implemented for live models (tasks 3.2–3.5) |
| Last live test | None. Next: the operator signs in under Settings → Connections and sends a test message |

After the operator's live check, record here: the date, whether the sign-in succeeded, the test model and its reply or error, the access token lifetime (from the status `expiresAt`), and whether a test after expiry refreshed silently. Do not record tokens, account e-mail addresses or screenshots of the consent page with personal data.

Pi 1.4.0's [provider documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md) describes the older Codex provider as legacy. Do not copy a host application's credentials, assume subscription eligibility, or silently fall back to paid API-key usage. See [the ChatGPT connection guide](chatgpt-connection.md) for the flow, storage and limits.
