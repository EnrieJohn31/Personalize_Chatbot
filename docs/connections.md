# Connections: ChatGPT and OpenCode

Build Plan task 3.1, extended on 24 October 2026. Each user connects their own AI accounts on the **Connections** page, which has its own entry in the main menu and in the chat sidebar (`/connections`; the old `/settings/connections` address redirects there).

| Card | Provider ID | How it connects | Billing |
| --- | --- | --- | --- |
| ChatGPT | `openai` | OpenAI's "Sign in with ChatGPT" for agents, in the browser | The user's ChatGPT plan, for example Plus or Pro |
| OpenCode Go | `opencode-go` | The user's OpenCode API key | The user's OpenCode Go subscription |
| OpenCode Zen | `opencode` | The user's OpenCode API key | Pay as you go from the user's Zen balance; free models cost nothing |

The engine keeps every sign-in and key encrypted. Laravel and the browser only ever see non-secret status. The page also chooses which connection and model chat uses.

**Status:**
- Implemented, and tested with fakes and live-engine browser probes on a network without internet access.
- No real sign-in or key has been used yet, so live access is unverified; see the [provider matrix](provider-matrix.md).
- Chat replies still come from the built-in simulation. Task 3.2 makes chat use the chosen connection.

## Using it

**ChatGPT**
1. Choose **Sign in with ChatGPT**, then **Open sign-in page**. A new tab opens on `auth.openai.com`. Sign in and approve access.
2. OpenAI redirects that tab to `http://127.0.0.1:1455/auth/callback`, which the engine receives through the published loopback port. The page notices within a few seconds.
3. If the tab instead shows a connection error at `127.0.0.1:1455`, copy the full address from its address bar into the page and choose **Finish sign-in**. This is the case when the browser does not run on the Docker host.

**OpenCode Go or Zen**
1. Create an API key at [opencode.ai/auth](https://opencode.ai/auth). The same key works for both services.
2. Paste it into the card and choose **Save key**. Use **Replace key** or **Remove key** later.

**When connected**
- **Send test message** sends one short message to the chosen model and shows the reply or the provider's error. At most six tests run per minute per user.
  - ChatGPT tests use `ASSISTANT_CONNECTION_TEST_MODEL` (`gpt-5.4-mini`) and count toward the plan.
  - OpenCode tests default to the free `beam-free` model (`ASSISTANT_OPENCODE_GO_TEST_MODEL`, `ASSISTANT_OPENCODE_ZEN_TEST_MODEL`), so a test costs nothing on Zen.
- **Use for chat** chooses a connected account and one of its models, or the built-in assistant. Disconnecting the chosen account returns chat to the built-in assistant.
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

- **Providers.** `config/assistant.php` → `connection_providers` lists the three cards in page order, with their name, `auth` method (`oauth` or `api_key`) and test model. Routes accept only these provider IDs, and each action checks the method: a key for ChatGPT, or a browser sign-in for OpenCode, is a 404.
- **Connection records.** `ProviderConnections` finds or creates one `provider_connections` row per user and provider when the user first connects; viewing the page creates none.
  - It mirrors the engine's status into the row: `connected`, `not_configured` or `reauth_required`.
  - `credential_reference` holds `engine:{id}`, a pointer, never a secret. Only `connected` lets `RunRequestFactory` use the connection for a live model.
- **Chat choice.** It is stored on the user as `chat_connection_id` and `chat_model`. Saving checks the engine's current status, so the connection must be connected and the model in its catalog. Task 3.2 reads it.
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

## Limits and open items

- Live behavior with real accounts is unverified: ChatGPT eligibility, the token lifetime and refresh after expiry, OpenCode key acceptance, and refusals for specific models. Record the results in the provider matrix.
- A ChatGPT sign-in in progress lives in engine memory. An engine restart ends it and the user starts again. Stored sign-ins and keys survive restarts.
- Inside the Compose network, the Laravel and MySQL containers can reach the callback listener during a sign-in. A request carrying `error=` would end that sign-in; one with a wrong `state` is ignored. This is acceptable for development.
- An API key typed into the page crosses the browser–Laravel connection once. Use HTTPS outside local development.
- The engine keeps one Pi `Models` object per connection it has seen, for the life of the process. That is bounded by the number of connection records.
- Pi's legacy `openai-codex` provider reuses the Codex CLI's OAuth client and is deliberately not used.

## Checks

```powershell
docker compose exec agent npm test                                  # vault, sign-in and key flows, endpoints, contracts
docker compose exec --user sail laravel.test php artisan test --filter="Connection"
docker compose exec --user sail laravel.test composer ci:check
```
