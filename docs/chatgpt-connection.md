# ChatGPT subscription connection

Build Plan task 3.1. Each user can connect their own ChatGPT account (for example Plus or Pro) under **Settings → Connections**. The engine runs the sign-in with Pi 1.4.0's OpenAI provider, which uses OpenAI's own "Sign in with ChatGPT" for agents. The engine keeps the resulting tokens encrypted. Laravel and the browser only ever see non-secret status.

**Status:** implemented and tested with fakes and a live-engine browser probe. The live sign-in with a real account has not been done yet, so it is still unverified (see [provider matrix](provider-matrix.md)). Chat replies still come from the simulation; task 3.2 switches them to the connection.

## Using it

1. Open **Settings → Connections** and choose **Sign in with ChatGPT**.
2. Choose **Open sign-in page**. A new tab opens on `auth.openai.com`. Sign in and approve access.
3. OpenAI redirects that tab to `http://127.0.0.1:1455/auth/callback`, which the engine receives through the published loopback port. The settings page notices within a few seconds.
4. If the tab instead shows a connection error at `127.0.0.1:1455`, copy the full address from its address bar into the page and choose **Finish sign-in**. This is the case when the browser does not run on the Docker host.
5. When connected, **Send test message** sends one short message to the chosen model and shows the reply or the provider's error. **Disconnect ChatGPT** removes the sign-in from the engine.

OpenAI decides during sign-in whether the account may be used this way, and which models the plan may call. The page lists Pi's catalog of 42 OpenAI chat models; a model the plan cannot use fails the test with OpenAI's message. Every test message counts toward the plan's usage, so the page sends one only on request (at most six per minute per user). The default test model is `ASSISTANT_CONNECTION_TEST_MODEL` (`gpt-5.4-mini`).

Disconnecting removes the tokens from this engine only. To revoke access completely, also remove the app in the ChatGPT account's settings.

## How it works

```text
Browser ──Inertia──▶ Laravel ──signed HTTP──▶ engine (Pi) ──▶ auth.openai.com / api.openai.com
   │                    │                        │
   │                    └ provider_connections   └ agent-data volume: installation ID,
   │                      (status only)            one AES-256-GCM file per connection
   └──── redirect to http://127.0.0.1:1455/auth/callback ──▶ engine callback listener
```

- **Connection record.** `SubscriptionConnections` finds or creates the user's `provider_connections` row (`openai`, `oauth`). It mirrors the engine's status into it: `connected`, `not_configured` or `reauth_required`. `credential_reference` holds `engine:{id}`, a pointer, never a secret. Only `connected` lets `RunRequestFactory` use the connection for a live model.
- **Sign-in.** The engine's `ConnectionManager` runs Pi's `login()` with the installation's stable UUID (`installation-id` in the data volume, sent to OpenAI as the agent host ID) and the application name (`APP_NAME`, reduced to `[A-Za-z0-9 ._-]`) as the consent-screen name.
  - Pi races its callback listener against a pasted address. The engine checks a pasted address against the pending sign-in's `redirect_uri` and `state` first, so a mistyped or stale address is refused without ending the sign-in.
  - Only one sign-in runs at a time, because the provider fixes the callback port. A second user gets `login_in_progress`. An unfinished sign-in is cancelled after 10 minutes.
- **Storage.** `CredentialVault` implements Pi's `CredentialStore` with one file per connection under `/var/lib/agent/credentials`.
  - The files are AES-256-GCM encrypted. The key is SHA-256 of `AGENT_CREDENTIAL_KEY`, and the connection ID is authenticated data, so a file moved to another connection fails.
  - Writes are serialized and atomic (private temporary file, then rename). The directory is `0700` and the files `0600`.
  - Pi refreshes the access token under the vault's lock when it has less than five minutes left. Laravel never sees it.
- **No silent API billing.** The engine gives Pi an auth context without environment variables or files. `OPENAI_API_KEY` is never used, even if it is set; a test proves Pi would otherwise use it.
- **Page updates.** While a sign-in runs, the page reloads only its `chatgpt` prop every two seconds after each answer, and pauses while a form submits. The page and its sign-in actions take Laravel's session lock (`->block()`), so a poll cannot overwrite an action's flashed errors.
- **Pasted address.** It carries a one-time code that only works with the engine's PKCE verifier. Laravel never flashes it as old input (`bootstrap/app.php`) and never logs it.

Engine endpoints and schemas are in [the contracts](../contracts/README.md#provider-connections).

## Setup and upgrade

`./scripts/setup.ps1` generates `AGENT_CREDENTIAL_KEY` in `.env`. For an existing checkout:

```powershell
# 1. Add AGENT_CREDENTIAL_KEY to .env (at least 32 random characters), then:
docker compose up -d --build agent          # new image, port 1455, agent-data volume, key
docker compose exec --user sail laravel.test npm run build
docker compose exec --user sail laravel.test php artisan agent:check   # providerAuth: configured
```

- **Keep the key stable.** Changing it makes existing sign-ins unreadable: the page then shows "Sign in again", and signing in replaces the file. In production the key belongs in a secret store visible only to the engine. In development `.env` is also mounted into the Laravel container, but the tokens themselves stay in the engine's volume.
- **The callback port is fixed by OpenAI.** It is published only on loopback (`127.0.0.1:1455`), and the listener runs only during a sign-in.
  - If another program holds port 1455 on the host (for example the Codex CLI during its own login), the engine container cannot start until it is freed.
  - On a remote server, the browser's redirect cannot reach the engine; use the paste step.
- **Keep the volume.** `docker compose down -v` deletes the `agent-data` volume with every stored sign-in and the installation ID. Routine `docker compose down` keeps them.

## Limits and open items

- Live behavior with a real account is unverified: eligibility, the token lifetime, a refresh after expiry, and refusals for specific models. Record the results in the provider matrix.
- A sign-in in progress lives in engine memory. An engine restart ends it and the user starts again. Stored sign-ins survive restarts.
- Inside the Compose network, the Laravel and MySQL containers can reach the callback listener during a sign-in. A request carrying `error=` would end that sign-in; one with a wrong `state` is ignored. This is acceptable for development.
- The engine keeps one Pi `Models` object per connection it has seen, for the life of the process. That is bounded by the number of connection records.
- Only OpenAI is offered. Pi's legacy `openai-codex` provider reuses the Codex CLI's OAuth client and is deliberately not used.

## Checks

```powershell
docker compose exec agent npm test                                  # vault, sign-in flows, endpoints, contracts
docker compose exec --user sail laravel.test php artisan test --filter="Connection"
docker compose exec --user sail laravel.test composer ci:check
```
