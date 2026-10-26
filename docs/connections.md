# Connections: ChatGPT, OpenCode and a local model server

Build Plan task 3.1, extended on 24 October 2026; chosen-provider acceptance completed on 25 October. Each user connects their own AI accounts on the **Connections** page, which has its own entry in the main menu and in the chat sidebar (`/connections`; the old `/settings/connections` address redirects there). The administrator can also offer one local model server to every user.

| Card | Provider ID | How it connects | Billing |
| --- | --- | --- | --- |
| ChatGPT | `openai` | OpenAI's "Sign in with ChatGPT" for agents, in the browser | The user's ChatGPT plan, for example Plus or Pro |
| OpenCode Go | `opencode-go` | The user's OpenCode API key | The user's OpenCode Go subscription |
| OpenCode Zen | `opencode` | The user's OpenCode API key | Pay as you go from the user's Zen balance; free models cost nothing |
| Local model (named by `LOCAL_LLM_NAME`) | `local` | The administrator's OpenAI-compatible server (Ollama, LM Studio, llama.cpp or vLLM), set in `.env` | Nothing per message; it runs on your own hardware |

The engine keeps every sign-in and key encrypted. Laravel and the browser only ever see non-secret status. The page also chooses which connection and model chat uses; the local server can be chosen exactly like the others.

**Status:**
- Implemented, and tested with fakes and live-engine browser probes on a network without internet access. The local server was probed with a fake OpenAI-compatible server, including stopping and restarting it.
- The operator's real ChatGPT sign-in, replies, restart persistence and refresh after expiry have passed. The 25 October refresh test used `gpt-6-luna`, returned `Connected` and advanced the stored expiry without another sign-in. OpenCode keys and a real local server remain unverified; see the [provider matrix](provider-matrix.md).
- Since task 3.2, chat replies come from the connection and model each conversation records ([chat-ui.md](chat-ui.md)). `ASSISTANT_LIVE_REPLIES=false` switches every chat back to the built-in simulation.
- When a reply or a test message finds a ChatGPT sign-in whose renewal was rejected, the engine reports the connection as `reauth_required` until the user signs in again. The card then shows **Sign in again** with the provider's reason and the time, and chat stops using it. The engine keeps connection IDs, bounded reason codes, safe explanations and times in `renewal-rejections.json` in its data volume, so a restart does not hide it. Unknown renewal failures use a fixed explanation; raw exception text and provider descriptions are not copied into that record or the renewal diagnostic. Invalid saved entries are ignored, and at most 1,000 valid entries are loaded.
- The engine log records each renewal (`sign-in renewed; access valid until …`) and each failed one, with the provider's reason code: `refresh_token_invalidated` (OpenAI ended the sign-in), `refresh_token_expired`, `refresh_token_reused`, or a network cause. Tokens are never logged. Read it with `docker compose logs agent | grep "sign-in"`.
- A renewal that never got an answer from OpenAI is not a rejection. A network or certificate failure, a timeout, or an HTTP 408, 429 or 5xx token response ends that reply or test with a retryable `provider_error`; its message names the cause. The account stays connected, and the next request renews the same stored sign-in. A refusal (HTTP 400, 401 or 403, `invalid_grant`, a revoked token) or an unrecognized failure still asks for a new sign-in.

## Using it

**ChatGPT**
1. Choose **Sign in with ChatGPT**, then **Open sign-in page**. A new tab opens on `auth.openai.com`. Sign in and approve access.
2. OpenAI redirects that tab to `http://127.0.0.1:1455/auth/callback`, which the engine receives through the published loopback port. The page notices within a few seconds.
3. If the tab instead shows a connection error at `127.0.0.1:1455`, copy the full address from its address bar into the page and choose **Finish sign-in**. This is the case when the browser does not run on the Docker host.

**OpenCode Go or Zen**
1. Create an API key at [opencode.ai/auth](https://opencode.ai/auth). The same key works for both services.
2. Paste it into the card and choose **Save key**. Use **Replace key** or **Remove key** later.

**Local model server**
- Users connect nothing. Once the administrator sets it up (see [Setup](#setup-and-upgrade)), the card shows **Available** with the server's address and the models it lists, and every user can test it or choose it for chat.
- **Not set up** means `LOCAL_LLM_URL` is empty; the card shows an example. **Not answering** means the server did not respond; the card shows the reason and the usual fixes.
- The card has no key, **Replace key** or **Disconnect**.

**When connected**
- **Send test message** sends one short message to the chosen model and shows the reply or the provider's error. At most six tests run per minute per user.
  - ChatGPT tests use `ASSISTANT_CONNECTION_TEST_MODEL` (`gpt-5.4-mini`) and count toward the plan.
  - OpenCode tests default to the free `beam-free` model (`ASSISTANT_OPENCODE_GO_TEST_MODEL`, `ASSISTANT_OPENCODE_ZEN_TEST_MODEL`), so a test costs nothing on Zen.
  - Local tests use `LOCAL_LLM_TEST_MODEL` when the server lists it, otherwise the first listed model. They cost nothing, but a large model may take a while to load first.
- **Use for chat** chooses a connected account (or the available local server) and one of its models, or the built-in assistant. Disconnecting the chosen account returns chat to the built-in assistant.
  - Each new conversation keeps the choice made when it started (`conversations.model_provider` and `model`); a later choice applies to new conversations only. The chat header shows which account and model answer, and links here.
- **Disconnect** removes the sign-in or key from this engine only. To revoke access completely, also remove it in the ChatGPT account settings or at opencode.ai.
- **Delete application account** first disconnects all of that user's records for supported providers, including duplicate records and unfinished sign-ins. The database account is deleted only after the engine confirms removal. If cleanup fails, the account stays signed in and the delete dialog shows an error; retry after the engine recovers. Connections already removed by an earlier step stay disconnected. Accounts with no supported-provider records can still be deleted without the engine.

The providers decide which models an account may use. The page lists Pi 1.4.0's catalogs: 42 OpenAI chat models, 29 for OpenCode Go and 83 for OpenCode Zen. A model the account cannot use fails the test with the provider's message.

## How it works

```text
Browser ──Inertia──▶ Laravel ──signed HTTP──▶ engine (Pi) ──▶ auth.openai.com / api.openai.com / opencode.ai
   │                    │                        │
   │                    ├ provider_connections   └ agent-data volume: installation ID,
   │                    │  (status only)           one AES-256-GCM file per connection
   │                    └ users.chat_connection_id, chat_model
   └──── ChatGPT redirect to http://127.0.0.1:1455/auth/callback ──▶ engine callback listener
```

- **Providers.** `config/assistant.php` → `connection_providers` lists the four cards in page order, with their name, `auth` method (`oauth`, `api_key` or `none`) and test model. Routes accept only these provider IDs, and each action checks the method: a key for ChatGPT, a browser sign-in for OpenCode, or a key, sign-in or disconnect for the local server, is a 404.
- **Local model server.** Its address exists only in the engine's environment (`LOCAL_LLM_URL`, `LOCAL_LLM_NAME`, optional `LOCAL_LLM_API_KEY`). No request can change it, so users cannot point the engine at other hosts.
  - `LocalModelServer` reads `GET {url}/models` with a 3-second timeout, keeps the model IDs the contracts accept (at most 200), and caches the answer for 15 seconds. It never throws; a failure becomes "not answering" with a reason.
  - It gives Pi an OpenAI-compatible provider (`openai-completions`, streaming, system role instead of developer role, no reasoning effort). Pi refuses to call a provider without a key, so the engine sends `LOCAL_LLM_API_KEY` or the placeholder `unused`, which keyless servers ignore.
  - Laravel reads it through the signed `GET /internal/local-model`. Each user who chooses it gets a `provider_connections` row with `auth_method` `none` and no `credential_reference`. Visiting Connections mirrors the server's state into that row (`connected` or `unreachable`), so a chat blocked while the server was down works again once the page sees it answer.
- **Connection records.** `ProviderConnections` finds or creates one `provider_connections` row per user and provider when the user first connects; viewing the page creates none.
  - It mirrors the engine's status into the row: `connected`, `not_configured` or `reauth_required`.
  - `credential_reference` holds `engine:{id}`, a pointer, never a secret. Only `connected` lets `RunRequestFactory` use the connection for a live model.
- **Chat choice.** It is stored on the user as `chat_connection_id` and `chat_model`. Saving checks the engine's current status, so the connection must be connected and the model in its catalog. Each new conversation records it, and runs use that record (task 3.2).
- **ChatGPT sign-in.** The engine's `ConnectionManager` runs Pi's `login()`. It passes the installation's stable UUID (`installation-id` in the data volume, sent to OpenAI as the agent host ID) and the application name (`APP_NAME`, reduced to `[A-Za-z0-9 ._-]`) as the consent-screen name.
  - Pi races its callback listener against a pasted address. The engine checks a pasted address against the pending sign-in's `redirect_uri` and `state` first, so a mistyped or stale address is refused without ending the sign-in.
  - Only one sign-in runs at a time, because OpenAI fixes the callback port. A second user gets `login_in_progress`. An unfinished sign-in is cancelled after 10 minutes.
- **OpenCode keys.** A key passes once from the browser through Laravel to the engine's signed `PUT /internal/connections/{id}/key`.
  - The engine stores it as Pi's `api_key` credential. It is never returned, logged or kept by Laravel.
  - Laravel never flashes `api_key` (or a pasted sign-in address) as old input (`bootstrap/app.php`).
  - Test messages carry an `x-opencode-session` ID, which OpenCode requires.
- **Storage.** `CredentialVault` implements Pi's `CredentialStore` with one file per connection under `/var/lib/agent/credentials`.
  - The files are AES-256-GCM encrypted. The key is SHA-256 of `AGENT_CREDENTIAL_KEY`, and the connection ID is authenticated data, so a file moved to another connection fails.
  - Writes are serialized and atomic (private temporary file, then rename). The directory is `0700` and the files `0600`.
  - Pi refreshes a ChatGPT access token under the vault's lock when it has less than five minutes left.
  - The ChatGPT card therefore says the account stays connected until the user disconnects it, without the access token's expiry time, which needs no action. The engine's status still reports `expiresAt`. A refresh token that OpenAI rejects (for example after a password change) shows up on the next test message or reply as `reauth_required`. A renewal blocked by the network, for example by security software that intercepts HTTPS after a reboot, does not.
- **No silent API billing.** The engine gives Pi an auth context without environment variables or files. `OPENAI_API_KEY` and `OPENCODE_API_KEY` are never used, even if set; a test proves Pi would otherwise use them.
- **Page updates.** While a ChatGPT sign-in runs, the page reloads only its `connections` prop every two seconds after each answer, and pauses while any form submits. The page and its actions take Laravel's session lock (`->block()`), except the test message, which can take a minute. A poll therefore cannot overwrite an action's flashed answer.

Engine endpoints and schemas are in [the contracts](../contracts/README.md#provider-connections).

## Setup and upgrade

`./scripts/setup.ps1` generates `AGENT_CREDENTIAL_KEY` in `.env`. For an existing checkout:

```powershell
# 1. Add AGENT_CREDENTIAL_KEY to .env (at least 32 random characters), then:
docker compose up -d --build agent          # new image, port 1455, agent-data volume, key
docker compose exec --user sail laravel.test php artisan migrate   # users.chat_connection_id and chat_model
docker compose exec --user sail laravel.test npm run build
docker compose exec --user sail laravel.test php artisan agent:check   # providerAuth: configured
```

- **Keep the key stable.** Changing it makes existing sign-ins and keys unreadable: the page then shows "Connect again", and connecting replaces the file. In production the key belongs in a secret store visible only to the engine. In development `.env` is also mounted into the Laravel container, but the credentials themselves stay in the engine's volume.
- **The ChatGPT callback port is fixed by OpenAI.** It is published only on loopback (`127.0.0.1:1455`), and the listener runs only during a sign-in.
  - If another program holds port 1455 on the host (for example the Codex CLI during its own login), the engine container cannot start until it is freed.
  - On a remote server, the browser's redirect cannot reach the engine; use the paste step.
- **Keep the volume.** `docker compose down -v` deletes the `agent-data` volume with every stored sign-in and key and the installation ID. Routine `docker compose down` keeps them.

**Local model server.** Set the address in `.env` and recreate the engine (`docker compose up -d agent`). Use the server's OpenAI-compatible base URL, including `/v1`:

| Server | `LOCAL_LLM_URL` | Notes |
| --- | --- | --- |
| Ollama on the Docker host | `http://host.docker.internal:11434/v1` | On Linux, Ollama must listen on all addresses: set `OLLAMA_HOST=0.0.0.0` and restart it |
| LM Studio on the Docker host | `http://host.docker.internal:1234/v1` | Start its local server; on Linux also enable "Serve on local network" |
| A server on the local network | `http://192.168.1.20:8000/v1` | It must listen on its network address; llama.cpp (`llama-server --host 0.0.0.0`) and vLLM serve `/v1` |

- `host.docker.internal` reaches the Docker host; Compose maps it to the host gateway (`extra_hosts`), so it also works on Linux. Docker Desktop on Windows and macOS usually forwards it to the host's own `localhost` as well.
- `LOCAL_LLM_NAME` names the card for both Laravel and the engine. Set `LOCAL_LLM_API_KEY` only when the server was started with a key (for example vLLM `--api-key`). `LOCAL_LLM_TEST_MODEL` picks the default test model.
- The URL must be plain `http` or `https` without a user name, password, query or fragment, or the engine refuses to start. Leave it empty and the card shows **Not set up**.

## Limits and open items

- Live acceptance applies to the operator's ChatGPT connection and `gpt-6-luna`. A real renewal was subsequently refused on 26 October with `refresh_token_invalidated`; the provider's underlying reason is unknown. Sign-in after that refusal and other accounts/models, OpenCode keys and a real local server remain unverified. Rejected renewal and re-authentication are also covered with fakes. The provider matrix records the actual expiry observations; they do not establish a guaranteed token lifetime.
- A ChatGPT sign-in in progress lives in engine memory. An engine restart ends it and the user starts again. Stored sign-ins and keys survive restarts.
- Inside the Compose network, the Laravel and MySQL containers can reach the callback listener during a sign-in. A request carrying `error=` would end that sign-in; one with a wrong `state` is ignored. This is acceptable for development.
- An API key typed into the page crosses the browser–Laravel connection once. Use HTTPS outside local development.
- The engine keeps one Pi `Models` object per connection it has seen, for the life of the process. That is bounded by the number of connection records.
- Pi's legacy `openai-codex` provider reuses the Codex CLI's OAuth client and is deliberately not used.
- The local server is shared: everyone on this installation can use it, and there is no per-user quota beyond the run limit. Its traffic is plain HTTP unless the server offers HTTPS, so keep it on a trusted network.
- Local models report no context window or output limit through the OpenAI API. The engine assumes 32,768 and 8,192 tokens, which are not configurable yet.
- Security software that inspects HTTPS (for example an antivirus "scan encrypted connections" setting) re-signs provider traffic with its own certificate, which the engine rejects. Sign-ins, tests and replies then fail with "fetch failed" or a certificate error. Exclude the provider hosts from scanning, or give the engine the security product's root certificate (`NODE_EXTRA_CA_CERTS`).

## Checks

```powershell
docker compose exec agent npm test                                  # vault, sign-in and key flows, endpoints, contracts
docker compose exec --user sail laravel.test php artisan test --filter="Connection"
docker compose exec --user sail laravel.test composer ci:check
```
