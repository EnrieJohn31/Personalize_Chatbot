# Foundation validation

## Task 3.4: bounded context and token budgets — 27 October 2026

Laravel now drops oldest owned messages only when the exact signed run body exceeds 1 MiB. The Pi engine selects whole recent messages under the chosen model's context window, reserves output, and rechecks after tool/model rounds. It reports `context_limit_exceeded` before a provider request that would exceed the budget. [Budget rules and configuration](context-budget.md) contain the calculation and limits.

| Check | Result |
| --- | --- |
| Engine `npm test` | TypeScript build and **105 tests passed**, including recent-answer recall, oversized newest question, small model window, output cap and tool-round context growth |
| `composer ci:check` | **256 Laravel tests / 1416 assertions**, **28 frontend tests**, formatting (136 files), lint (96 files), TypeScript, Pint (123 files) and PHPStan (91 files) passed |
| Signed body | A 46-message owned history was trimmed below the 1 MiB request limit while retaining the pending question; the shared PHP/engine v1 examples and bounds passed |
| Signed connectivity | `php artisan agent:check` passed after the implementation: engine status `ok`, provider/request authentication configured, signature accepted and unsigned request refused. No run was started |
| Live provider | No new provider request was made. The recorded ChatGPT renewal refusal still requires the owner's new sign-in before live acceptance can be repeated |

The byte-based input estimate deliberately leaves unused room and is not a provider tokenizer. No production token-usage or throughput measurement was made. The implementation uses the existing local services and test databases; no stored chat or provider credential was changed by the checks.

## Review of renewal diagnostics and engine recovery — 26 October 2026

Reviewed `912b83a`, which adds a persisted refusal reason/time, the Connections card display and development engine supervision. Two defects were reproduced and corrected before publication:

- An unrecognized renewal error copied its innermost message, or an `error_description` paired with `renewal_failed`, into the response, log and unencrypted refusal record. Redacting only strings of 40 characters or more left shorter credentials exposed. Unknown failures now use a fixed explanation; provider reason codes remain bounded and known reasons retain their explanations.
- A null saved entry threw during loading and rejected the cached map promise, breaking subsequent status reads/writes. Loading now skips malformed entries, requires the contract's message/time fields and bounds, rejects array roots and retains at most the newest 1,000 valid entries.

All three new regression tests failed before these fixes and pass afterward, using invented credentials and isolated temporary files. No real credential exposure was observed in this review.

| Check rerun | Result |
| --- | --- |
| Engine `npm test`, after fixes | TypeScript build and **100 tests passed** |
| `composer ci:check` | **255 Laravel tests / 1408 assertions**, **28 frontend tests**, formatting (136 files), lint (96 files), TypeScript, Pint (123 files) and PHPStan (91 files) passed |
| Production frontend build | Passed in 135 seconds; the existing optional `fontaine` warning remains non-fatal |
| Signed connectivity | `php artisan agent:check` passed before and after the fixes; no provider run started |
| Supervisor | Syntax check passed; the running container uses `node scripts/dev-supervisor.mjs` with `unless-stopped`. The earlier isolated 44-second recovery result below was reviewed, not rerun; this review did not deliberately crash the user's engine |
| Contributor checks | Existing reachable history passed the audit; approved human identity and hooks preserved. Credentials, `.claude/`, probes and generated dependencies stay excluded |

The handoff and provider matrix now distinguish the confirmed `refresh_token_invalidated` response from the earlier HTTPS-scanning hypothesis. The stale resume prompt now points to task 3.4. Supervisor documentation distinguishes restarting after a script edit from applying changed Compose configuration. No dependency, migration or real user data changed. Live sign-in/replies, browser visual acceptance of the new card and remote CI were not rerun. The original commit is preserved, followed by the review fixes and documentation. Task 3.4 remains next; future optimization should measure the existing Windows bind-mount build overhead before changing the toolchain.

Publication: original `912b83a` and review fixes `7c65af5` were pushed atomically to `main` and `development` at the user's request. `git ls-remote --heads origin main development` verified both at `7c65af556f6cf684bebb60779c998d1f05a831e5` before adding this publication record. Both saved author and committer are the approved human identity, with no co-author trailer or prohibited attribution.

## Why the ChatGPT sign-in ended; renewal log and engine self-restart — 26 October 2026

**Correction to the entry below.** That entry guessed that HTTPS scanning caused the 10:35 UTC renewal failure. It did not. At 10:53 UTC, after the network-failure fix was live and with scanning paused, a renewal was refused again and classified as a refusal. A direct renewal attempt with the stored sign-in (same engine code, only OpenAI's answer printed, no token) returned `400 invalid_grant`, reason `refresh_token_invalidated`: "The refresh token has been invalidated. A fresh sign-in is required." OpenAI distinguishes this from `refresh_token_expired` and `refresh_token_reused`.

Facts gathered:
- The stored sign-in was intact: its file was last written at the 25 October 11:54:03 UTC renewal, with its app ID and all scopes, including `offline_access`.
- Only one engine has ever held the sign-in. That engine crashed at 13:07:49 UTC on 25 October, when a Git operation briefly removed `src/index.ts`, and stayed down until the host restart at 10:08 UTC on 26 October. It made no OpenAI request in that window, so a shutdown could not have interrupted a renewal.
- An earlier renewal had succeeded after about 25 idle hours, so this was not a plain idle limit.

OpenAI ended the grant on its side; why is not visible to the app. A new sign-in is the only remedy.

Changes:
- **Renewal reason.** A refusal keeps the provider's reason code and message. The engine stores it, without secrets, in `renewal-rejections.json` in its data volume, so it survives restarts. It reports the reason in the connection status (new optional `rejection` field, older engines still accepted) and logs every renewal and every failed one. The card shows the message and the time.
- **Engine self-restart.** Development Compose runs `tsx watch` through `agent-service/scripts/dev-supervisor.mjs` with `restart: unless-stopped`. The supervisor restarts the watcher when it exits or the health endpoint has not answered for 45 seconds.

| Check | Observed result |
| --- | --- |
| Engine `npm test` (worktree sources in a container from the running engine image) | **97 passed**, 2 new: a refusal keeps OpenAI's reason across an engine restart and clears with a new sign-in; each renewal is logged with its new expiry and no token. Existing refusal cases now also check the recorded reason (`invalid_grant`, `http_403`, `renewal_failed`) |
| Laravel `php artisan test` (worktree, SQLite) | **255 passed** / 1408 assertions; new cases parse a status with and without `rejection`, refuse five malformed rejections, and show the reason and time on the Connections page |
| Pint, PHPStan, `npm run check`, `types:check`, Vitest | Passed; 28 frontend tests |
| Recovery probe: `src/index.ts` removed for 3 s in two throwaway engine containers | `tsx watch` alone: **still down 90 s** after the file returned (the 25 October failure). With the supervisor: **back after 44 s**. `docker stop` of the supervised engine took 459 ms with exit code 0 |

Not verified: why OpenAI invalidated the grant, and whether it recurs. The log will show the reason and timing if it does. No live model request was made for this change.

## Publication review of refresh and Stop changes — 26 October 2026

Reviewed all three unpublished commits: `b59ecff` (real refresh acceptance), `3b0c463` (task 3.5 Stop) and `dc42637` (retryable renewal failures). No blocking code defect or prohibited contributor attribution was found. Original commits, messages and approved human author/committer identities were preserved.

| Check rerun for publication | Observed result |
| --- | --- |
| `composer ci:check` | **249 Laravel tests / 1396 assertions**, **28 frontend tests**, formatting (136 files), lint (96 files), TypeScript, Pint (123 files) and PHPStan (91 files) passed |
| Engine `npm test` | TypeScript build and **95 tests passed**, including renewal refusal/retry and Stop before/during execution |
| Production frontend build | Passed in **146 seconds**. Existing optional `fontaine` warning remains non-fatal. Build timing attributed 118 seconds to the Tailwind transform; generated assets remain ignored |
| Signed `php artisan agent:check` | Passed: configured authentication, valid signatures accepted and unsigned requests rejected; no provider request started |
| Contributor and repository checks | Full reachable-history attribution audit and whitespace checks passed. `.githooks`, approved identities and attribution settings unchanged; `.claude/`, credentials, temporary probes and generated dependencies remain ignored/untracked |

The Stop/renewal interaction was also reviewed against the installed Pi 1.4.0 implementation. Cancelling the caller stops waiting for authentication. Once a token renewal starts, Pi intentionally lets renewal and persistence finish under its separate 15-second timeout so a rotated refresh token is not lost. Late rejection is consumed. This is an implementation inspection, not a new live cancellation measurement; see [Stop limits](stop.md).

At the user's request, `main` was fast-forwarded and both branches pushed atomically. `git ls-remote --heads origin main development` verified both at **`dc426379d7ea85ead1515642475006d9330499e5`** before this review/publication record. This review changed documentation only and did not make a live provider request or alter user data. Earlier live acceptance remains dated evidence; the exact HTTPS failure described below and real OpenCode/local-server acceptance remain unverified. Remote CI results were not inspected. Task 3.4 remains next. For build speed, measure the existing Linux-filesystem relocation option before changing dependencies or build configuration.

## ChatGPT sign-in reported as expired after a network failure — 26 October 2026

The user reported that the ChatGPT connection had "expired" although it should stay connected until removed. On 26 October, both the Laravel record and the engine showed `reauth_required`, set at 10:35:51 UTC. The stored access token had expired on 25 October at 12:51 UTC, so the next reply or test had to renew it. The services had restarted at about 10:09 UTC, and a reboot turns the host's Kaspersky HTTPS scanning back on. That scanning had broken the first sign-in (see the handoff); by 10:39 it no longer intercepted OpenAI, so the exact failure at 10:35 could not be observed.

Cause: Pi reports every failed renewal as `ModelsError('oauth')`, with the original error as its `cause`: a network or certificate failure that never reached OpenAI, a timeout, a 5xx answer, or a genuine refusal. The engine treated all of them as a revoked sign-in and kept the connection at `reauth_required` until a new sign-in or an engine restart. A network blip therefore asked the user to sign in again, and blocked chat meanwhile.

Fix: the engine walks the error's `cause` chain. A certificate failure (with advice about HTTPS-scanning software), another connection failure, a timeout, or an HTTP 408/429/5xx token response now ends the reply or test with a retryable `provider_error`; the account stays connected, and the next request renews the same sign-in. HTTP 400/401/403, `invalid_grant`, a revoked token or an unrecognized failure still leads to `reauth_required`.

| Check | Observed result |
| --- | --- |
| Engine `npm test`, in a container from the running engine's image with the fix's sources | All 95 tests passed, 3 of them new: five interrupted-renewal kinds (certificate interception, a nested connection code, a bare fetch failure, a timeout, a 503) stay connected and renew on the next request; a chat run with an intercepted renewal fails with `provider_error` and leaves the account connected; four refusal and unknown kinds still require a new sign-in |
| Mutation check | With the classification disabled, exactly the two interrupted-renewal tests failed (93/95) |
| Live state before the fix | Record and engine `reauth_required`; certificate chains from the engine container showed the real issuers for `auth.openai.com` (both addresses), `chatgpt.com` and `api.openai.com` |

Not verified: the exact error at 10:35 UTC, which was not logged, and a renewal through real HTTPS interception. No live model request was made for this fix.

## Task 3.5: Stop during live replies and active tools — 25 October 2026

Completed before task 3.4 at the user's request. The engine now checks cancellation before credential setup, each model request and tool dispatch. Active tools combine the run and Pi signals with their timeout; cancellation stops waiting, drops late results and prevents later calls. Adapter rejection after abort becomes cancellation, and buffered text is not flushed after abort. `tool.finished` accepts the explicit `cancelled` outcome in both the shared schema and Laravel. See [Stop behavior and limits](stop.md).

Six new regression cases failed before the fixes: pre-stopped credential resolution, credential-setup rejection on abort, pre-aborted tool dispatch, Stop at `tool.started`, an active tool ignoring abort, and direct lookup with an already-aborted signal. Additional coverage exercises the complete Pi loop and repeated/late Stop. In the complete-loop case, Stop prevents the second queued tool and the next model request; no source, final answer or completion is emitted, and a late tool rejection is consumed.

| Check | Observed result |
| --- | --- |
| Engine `npm test` | TypeScript build and **92 tests passed** |
| `composer ci:check` | **249 Laravel tests / 1396 assertions**, **28 frontend tests**, formatting (136 files), lint (96 files), TypeScript, Pint (123 files) and PHPStan (91 files) passed |
| Controlled active tool | A deliberately non-cooperating tool's wrapper returned cancellation in **0.28 ms**; the complete Pi loop reached `run.cancelled` in **1.22 ms** in a separate controlled case. Local observations, not performance guarantees |
| Real browser reply | Chromium, the existing ChatGPT connection and `gpt-6-luna`, through the Laravel page and signed engine boundary. The model completed one `lookup_reference` call (`ok`) and was still streaming when Stop was clicked |
| Live Stop timing | From just before the click to browser `run.cancelled`: **5,655 ms**. DELETE request to HTTP `202`: **5,850 ms**. The stream's terminal event arrived before the HTTP acknowledgement |
| Stream and persistence | 12 text chunks before Stop; **38 more chunks observed while Stop was pending**. Exactly one cancellation; no `assistant.final`, `run.completed`, `run.failed` or stream error. History contained only the user message. Reload offered "Get a reply" and no Stop button; zero page errors |
| Signed connectivity after cleanup | `php artisan agent:check` passed: authentication configured, valid signatures accepted and unsigned requests rejected; no model run started |

The browser server used a new isolated SQLite database and a fixture user with the existing owned connection reference and selected model. Only non-secret connection metadata was copied; credentials stayed in the engine vault. No real MySQL chat rows were created or changed. The temporary internal server and browser container were stopped/removed; diagnostic scripts and SQLite data remain ignored under `.setup/`. Browser-probe configuration and an HTTP-response timing assertion were corrected before the successful run.

No dependency, lockfile, migration or frontend behavior changed. The production frontend build was not repeated; the existing built assets were used for the live browser check. The full application check corrected formatting in the earlier handoff tables before passing. Contributor review uses the approved human author/committer and active hooks; no contribution credits, co-author trailers, credentials, generated dependencies or `.claude/` files are included.

Limits: the real lookup is synchronous and finished before this browser Stop, so active-tool cancellation was verified with a controlled slow tool inside the real Pi loop, not by delaying the production lookup. The observed browser delay includes local PHP request/relay and transport overhead; it does not isolate provider abort time or establish when remote computation/billing ceased. Future tools must honor the abort signal in their own I/O. Optimize the local Stop route/relay only after measuring those stages separately. Durable cancellation flags, atomic terminal races and restart recovery remain Phase 4–5; model-aware context/token budgets remain task 3.4.

Finalized on 26 October: updated the handoff, plan and blueprint, checked final Markdown/JSON formatting and whitespace, and audited the existing commit history against the contributor policy before the local checkpoint. Application behavior did not change during this continuation; the full test and live acceptance results above remain dated 25 October. No push was requested.

## Task 3.1: live refresh after expiry — 25 October 2026

The remaining chosen-provider acceptance passed using the operator's existing ChatGPT connection and selected `gpt-6-luna` model. One short test was sent through Laravel's `ProviderConnections::test()` and signed gateway. The engine used the existing encrypted sign-in and Pi's normal renewal path; no expiry was changed artificially and no new login was started.

All timestamps below use Asia/Shanghai (+08:00).

| Observation | Actual result |
| --- | --- |
| Before, 25 October 18:56:13 | Engine and Laravel `connected`; stored access expiry **24 October 19:12:14**, already in the past |
| Live test | Success; reply **Connected**; **7,155 ms**; no error code |
| After, 25 October 18:56:21 | Engine and Laravel still `connected`; stored expiry **25 October 19:53:16**, advanced into the future |
| Remaining validity after test | 3,415 seconds (56 minutes 55 seconds); full issuance lifetime was not independently measured |
| Signed connectivity | `php artisan agent:check` passed: configured authentication, signed requests accepted and unsigned requests rejected |
| Focused regressions | Engine TypeScript build passed; all **19** tests in `connections.test.mjs` and `credential-vault.test.mjs` passed, including renewal, rejected renewal, re-authentication, encrypted storage and serialized writes |

The status endpoint reads expiry from the encrypted vault, so the post-test value verifies that renewal was stored. Sign-in, normal live replies and persistence across engine restart were already observed on 24 October. Together these close task 3.1 for the chosen connection. No credentials, account details or connection identifiers were printed or added to Git; no chat rows were written. Only normal provider renewal and connection-status recording occurred. The temporary diagnostic remains ignored under `.setup/`.

This session changes documentation only. The full application suite, frontend build and browser probes were not rerun; their earlier dated results remain below. Provider-side revocation/re-authentication was not forced on the real account, and OpenCode/local-server live acceptance remains unverified. Task 3.4 (context/token budgets) and task 3.5 (real Stop acceptance) remain open.

## Pre-push review of tasks 3.2–3.3 — 24 October 2026

Reviewed the four commits from `93f3085` through `8ed22bb`, covering first-message streaming, live replies and the sample lookup. Three reproducible defects were fixed:

- Pi's validation error includes received tool arguments. The executor forwarded that text in `tool.finished`. Browser events now use a fixed explanation; the detailed result stays with the model.
- Shortening a tool result to its cap and then appending the notice exceeded the cap. The notice now consumes the same budget, including when the cap is smaller than the notice, without splitting surrogate pairs.
- Text from several model rounds could exceed the final-answer limit and be silently shortened while reporting success. The engine now aborts before streaming beyond 200,000 UTF-16 units and reports `output_limit_exceeded`, without a final answer or completion event. Context/token budgeting is still task 3.4.

Regression evidence: the three tool privacy/size cases failed before their fixes, and the multi-round output case separately failed before its guard. All pass afterward, including the existing valid lookup, stream/final equality, capability, duplicate-call, deadline and Stop coverage.

| Check rerun in this review | Observed result |
| --- | --- |
| `composer ci:check` | 247 Laravel tests / 1388 assertions; 28 frontend tests; formatting (136 files), lint (96 files), TypeScript, Pint (123 files) and PHPStan (91 files) passed |
| Engine `npm test`, after fixes | TypeScript build and all 84 tests passed |
| Production frontend build | Passed; existing optional `fontaine` warning remains non-fatal. About 156 seconds on the Windows bind mount |
| Live `php artisan agent:check` | Passed: configured authentication, valid signatures accepted and unsigned requests rejected; no provider run started |
| Contributor checks | Full reachable-history audit passed; approved human author/committer and `.githooks` active; no new contribution credits, co-author trailers, tracked credentials, dependencies or `.claude/` files |

No dependency or migration changed. The task 3.3 acceptance notes below were preserved from the existing sibling-worktree documentation, alongside the previous task 3.2 notes; these real provider calls and browser probes were not rerun in this review. Refresh after token expiry, model-aware context budgets, real Stop acceptance, durable runs and remote CI results remain outstanding. Keep the existing Linux-filesystem relocation suggestion as a future build-speed optimization.

Publication: review fixes committed as `9263393` with the approved human author and committer; the complete saved history passed the contributor audit. The requested atomic push advanced both `main` and `development`, preserving all four original commits. `git ls-remote --heads origin main development` confirmed both at `9263393f362352cea3aaa91305838ed63549c745` before adding this publication record. Signed connectivity passed again after the fixes.

## Task 3.3: the `lookup_reference` tool — 24 October 2026

A live reply can call the first engine tool, a read-only lookup in five invented records. The engine's tool executor checks each call, the run's tool and round budgets bound it, and new run events report each call and the sources it used. See [tools](tools.md) and [the contracts](../contracts/README.md#event-stream).

Contract changes:
- New run event types: `tool.started`, `tool.finished` and `source.added`.
- `capabilities` may now contain `lookup_reference`.
- The default profile is version 2, granting it through `ASSISTANT_CAPABILITIES`.

No migration and no dependency changed.

| Check | Observed result |
| --- | --- |
| Engine `npm test` | 81 passed (12 new; details below) |
| Laravel tests | 247 passed / 1388 assertions. New: the tool example stream, 8 rejected tool-event shapes, a relayed lookup run that saves only its answer, and the profile's capability snapshot |
| Frontend | 28 tests (1 new: the retrieving stage), formatting, lint (96 files), TypeScript and the production build passed |
| Static checks | Pint and PHPStan passed |
| Live acceptance | On the operator's stack after rebuilding the engine, two runs on `openai` / `gpt-6-luna` at reasoning `medium` through Laravel's signed gateway (no chat rows written). Details below |

**Live acceptance:**
- **With the tool permitted:** asked for "the reference code for our sample warehouse, and when are deliveries accepted there", the model called `lookup_reference` by itself (3.96 s) and received the warehouse record with two weaker matches. It answered from the fixture in 8.9 s: "The sample warehouse reference code is **SAMPLE-002**. Deliveries are accepted **weekdays from 07:00 to 15:00** and must be **booked one working day in advance**."
- **Events:** `tool.started`, three `source.added` and `tool.finished` (`ok`). All passed Laravel's event checks, including the provider's composite call ID with a `|`.
- **With no tools permitted** (`ASSISTANT_CAPABILITIES` empty): no tool events. The model said it did not have the warehouse details instead of inventing them.

**New engine tests:**
- The registry's contract.
- Lookup matching: a code, keywords, none, at most three.
- Executor checks: permission, repeated call IDs, the budget, arguments re-checked at execution, timeout, failure without leaking the error, and the size cap at a character boundary.
- End to end on Pi's faux provider:
  - the result reaching the next request and the answer;
  - text before and after the lookup joined;
  - a call without permission not running;
  - invalid arguments refused;
  - repeats and calls over the budget blocked;
  - the last round offered no tools.

Not checked: a lookup shown in the browser (the label and relay are covered by tests), and a tool timeout or Stop during a tool against a real provider. Remote CI was not inspected.

## Task 3.2: live replies through a Pi Agent per run — 24 October 2026

Chat replies now come from each conversation's recorded connection and model. The engine builds a fresh Pi Agent per run on the run's own connection and maps its stream to the existing run events. See [chat-ui.md](chat-ui.md), [connections.md](connections.md) and [the contracts](../contracts/README.md#engine-admission-order).

Two contract changes:
- **Run requests:** optional `model.reasoning` (`low`, `medium` or `high`; Laravel sends `ASSISTANT_REASONING`, default `medium`).
- **Connection status:** a `reauth_required` value. The engine remembers a rejected renewal, so viewing Connections no longer resets a rejection that a test or reply found.

No migration and no dependency changed. `ASSISTANT_LIVE_REPLIES` now defaults to `true`.

| Check | Observed result |
| --- | --- |
| Engine `npm test` | 69 passed (8 new live-run tests on Pi's faux provider, plus an extended re-authentication test) |
| Laravel tests | 237 passed / 1366 assertions (5 new tests and one data set). Covered: older conversations adopting the current choice, the reasoning value, sign-in failures from a reply marking the connection, the engine's `connection_required` refusal, a rejected sign-in surviving page views until a new sign-in, and the live run-request example |
| Static checks | Pint, formatting, lint (96 files), TypeScript, 27 frontend tests and PHPStan passed |
| Live acceptance | On the operator's real stack, after rebuilding the engine: two runs on `openai` / `gpt-6-luna`, reasoning `medium`, submitted and read through Laravel's signed `AgentGateway` on the operator's ChatGPT connection, with no chat rows written. The first answered "17 times 3 is 51." in 6.0 s (first text at 5.6 s). The second, a five-item Markdown list, streamed in 10 deltas between 2.7 s and 4.2 s. Both ended with `assistant.final` and `run.completed` |

**New engine tests:**
- Batched deltas that add up to the final answer, with the system prompt, history, stored key, reasoning and session ID reaching the model.
- Reasoning sent only to reasoning models.
- Admission refusals: no connection, an unknown provider, no local server, no credential store.
- `not_connected`, `model_unavailable` and `credentials_unreadable` failures, with no model request made.
- Provider and network errors, and an empty reply.
- Stop aborting the provider request.
- The deadline.
- 36,000 streamed characters split within the delta limit without breaking an emoji.

Notes:
- A host's HTTPS-scanning security software can break provider requests with "fetch failed"; see the connections guide. The live runs went to `api.openai.com`, which was not intercepted.
- Not checked live: a reply in the browser (the relay and page are unchanged and covered by tests), Stop and the deadline against OpenAI, a rejected refresh against OpenAI, OpenCode and local servers. Remote CI was not inspected.

## New chat refreshing on its first message; ChatGPT connection wording — 24 October 2026

The user reported that the chat page refreshed when they sent a message, and that the Connections card's "the current token is valid until 06:11 PM" read as a sign-in that would end.

- **Refresh.** On a new chat, the first message saved the message, started the reply and then made an Inertia visit to `/chat/{id}`. That server round trip remounted the page while the reply was streaming, and the new page picked the stream up again. Follow-ups in an existing chat were not affected. Now the page takes the conversation's address on the client (`router.push` with preserved state, `lib/conversation-address.ts`) and keeps streaming in place. Back and Forward still fetch the page again (`fresh-pages.ts`); the client visit is a `visit`-type navigation, which that handler ignores.
- **Wording.** The card now says the account stays connected until it is disconnected and that access renews automatically. That was already the behavior: the engine reports `connected` while a credential is stored, and Pi refreshes the access token when it is used. Only the copy changed.

| Check | Observed result |
| --- | --- |
| Browser probe, before the fix | Throwaway four-worker server on the main checkout with its own SQLite file, against the real engine's simulated replies. Failed: the first message in a new chat caused one Inertia page request to `/chat/{id}` and a remount of the page component (an attribute set on the composer was gone). The follow-up, reload, Back/Forward and console checks passed |
| Browser probe, with the fix | 6/6 passed, with a warm-up chat first: no full reload, remount, Inertia page request or document load during either send. The first reply's draft grew in place, and the transcript showed both replies after a reload, Back returned to a new chat and Forward to the conversation, with no console errors. Without the warm-up, there was still no reload or remount, but the first cold PHP requests on the bind mount (about 2 s) outlasted the 1.4-second simulated reply, which then arrived at once |
| `npm run check` | Passed: formatting for 134 files; lint for 96 files |
| `npm run types:check` | Passed |
| `npm run test` | All 27 frontend tests passed (2 new for `conversation-address.ts`) |
| `npm run build` | Passed; the main checkout's `public/build` now serves the fix |

PHP, engine and database code are unchanged; their suites were not repeated. The probe used simulated replies only, Chromium only. Live replies are task 3.2. A refresh after the ChatGPT access token's expiry remains unverified.

## Publication review of chat navigation fix — 24 October 2026

Reviewed `b6afd9b` with no blocking findings. Checked JSON-write cache invalidation, the Inertia finish/history event handlers, remounting with fresh page props and the deleted-conversation 404 fallback against the installed Inertia source. No application code changed during this review.

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed: formatting for 132 files; lint for 94 files, no warnings or errors |
| `npm run types:check` | Passed |
| `npm run test` | All 25 frontend tests passed, including the three navigation/cache cases |
| `npm run build` | Passed; the existing optional font fallback warning remains non-fatal |
| Contributor policy and publication | Full-history audit and all eight changed files reviewed; approved human author/committer, no prohibited credits or trailers, unchanged hooks/identities and ignored local settings. Both branches pushed atomically and their hashes verified as `b6afd9b` |

PHP, engine, database and dependency files are unchanged; their suites were not repeated. The earlier nine-check browser probe below was not rerun. Firefox, Safari, cross-site browser-cache restoration and remote CI results remain unverified. Task 3.1's real-provider acceptance is still open. No new optimization is needed for this focused fix; retain the existing frontend build-time follow-up.

## Deleted chats reappearing until a reload — 24 October 2026

The user reported that deleted chats only disappeared after a refresh. A browser probe reproduced it on an internal Docker network, with a worktree server (four PHP workers, like the development container) and twelve seeded conversations. Every deletion succeeded on the server; the page showed stale data in three ways:
- **Prefetch cache.** Hovering Chat in the main menu prefetches `/chat`, and Inertia reuses that response for 30 seconds. The chat page deletes through the JSON API, which never clears it. Within that window, deleting the open chat (which then opens `/chat`) or returning through the Chat link showed the deleted chats again.
- **Back and Forward.** Inertia restores a page from the copy saved in browser history without asking the server. A chat deleted meanwhile came back, and going back to a deleted chat showed it as if it still existed.
- **Same cause, unreported.** Going back to a chat also lost the messages sent there before leaving.

Fix: chat API writes, and completed Inertia writes, clear Inertia's prefetch cache. A chat page restored from history is fetched again; a 404 (deleted meanwhile) leads to a new chat with a notice. No server code changed.

| Check | Observed result |
| --- | --- |
| Browser probe, before the fix | 4/9 passed. Failed: Back after leaving, the prefetched Chat link, deleting the open chat from the header, Back to a deleted chat, and Back losing sent messages |
| Browser probe, with the fix | 9/9 passed, with no console errors. A reload showed exactly the list the page had shown. Deleting took about 1 s from confirming to the dialog closing |
| Frontend unit tests | 25 passed (3 new for `fresh-pages.ts`: which writes clear the cache, which restores are refetched, and the 404 path) |
| `composer ci:check` | Formatting (132 files), lint (94 files), TypeScript and PHPStan passed; the PHP suite rerun separately: 232 tests / 1332 assertions |

The first probe runs used a single-worker PHP server, where requests queued for about 5 s each and the probe moved on before refreshes finished; a trace showed this, and the probe server was given four workers and step waits on the page heading. Not checked: Firefox and Safari, and returning with Back from another website. Inertia reports that case with the same history event, unless the browser restores the page from its back-forward cache, which shows the page exactly as it was left. Changes made in another tab still appear only after a reload or the next visit.

## Publication review of local model changes — 24 October 2026

Reviewed `917cd5e` and `ea3be49`: administrator-only local-server configuration, signed endpoints and strict response parsing, credential-free local connections, account cleanup, per-conversation model selection, reply metadata, rate limiting, migrations and development PHP caching. No blocking findings; no application code changed during this review.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (130 files), lint (92 files), TypeScript, 22 frontend tests, Pint (123 PHP files), PHPStan (91 files), and 232 Laravel tests / 1332 assertions |
| Engine `npm test` | TypeScript build and all 61 tests passed, including local-server tests with invented credentials; hashes of the new local-model source, connection manager and server matched the running container |
| `npm run build` | Passed; the existing optional font fallback warning remains non-fatal |
| Live `php artisan agent:check` | Passed: signed probe reached validation, unsigned probe was rejected, simulation remains enabled; no run or provider request started |
| `php artisan migrate:status` | All 11 migrations already applied, including larger message content and conversation model columns; no migration or user-data change performed during review |
| Runtime PHP configuration | CLI OPcache enabled, timestamp validation enabled, `opcache.revalidate_freq=2` |
| Contributor policy and publication | Complete-history audit passed; approved author and committer for both commits, unchanged hooks and identity list, no prohibited attribution in the 67 changed files, `.claude/` ignored/untracked, generated dependencies and assets excluded. Both branches were pushed atomically and matched `ea3be49` |

The earlier 14-check browser probe, dependency audits, mutation checks and latency measurements were not repeated. No real local model server, subscription sign-in, key, refresh or credential restart-persistence check was performed. Task 3.1's live acceptance remains open; chat stays simulated until task 3.2. Remote CI results remain unverified. Retain the existing optimization follow-up: measure a Linux-filesystem checkout before further cache or bundle changes.

## Local model connection and pre-3.2 refinements — 24 October 2026

Requested by the user before task 3.2:
- **Local model server.** An administrator-configured OpenAI-compatible server (Ollama, LM Studio, llama.cpp or vLLM), on the Docker host or the local network, offered to every user and selectable in "Use for chat" like ChatGPT and OpenCode.
- **Refinements.**
  - Each conversation records the chat choice it started with.
  - Replies record the provider and model that wrote them, and the page shows it.
  - Account errors link to Connections.
  - Starting replies is rate-limited.
  - `messages.content` is widened to `MEDIUMTEXT`.
  - OPcache is enabled for the PHP CLI server.

See [connections.md](connections.md), [chat-ui.md](chat-ui.md), [chat-history.md](chat-history.md), [the contracts](../contracts/README.md#provider-connections) and [setup.md](setup.md). Two additive migrations; no dependency or lockfile changed. Rebuilding the PHP image is needed for OPcache.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (130 files), lint (92 files), TypeScript, 22 frontend unit tests, Pint, PHPStan (no errors), and 232 Laravel tests / 1332 assertions |
| Engine `npm test` | 61 tests passed, in an image rebuilt from the worktree |
| `npm run build` | Passed |
| Browser probe | 14/14 passed in four phases against a fake OpenAI-compatible server, the worktree's engine image and a worktree server, on an internal Docker network without internet access (details below) |
| Test speed | The PHP suite took 480 s without OPcache and 45–54 s with `opcache.enable_cli=1` in the same worktree container |
| Development server speed | In the real `laravel.test` container, `GET /up` took 1.5–6.1 s with `opcache.revalidate_freq=0` (the first committed setting). With `2` it took 0.17–0.30 s within a burst and 1.7 s when the 2-second recheck fell due. The setting was corrected to `2` |

**New Laravel tests (18, counting data sets):**
- **Connections (2).** Four cards, with the shared server asked about but no records created. The local card's listing, test and chat choice. Missing or down servers refused without a record, and the record following the server down and back up.
- **Chat (6).** Conversations keep the choice they started with, and clients cannot set it. The chat header's `assistant` prop for new chats, older chats and a down server. A live run using the conversation's local model and recording it on the reply. The new 409 messages. The 20-per-minute run limit.
- **Run requests (1).** The conversation's model is used only with live replies on; an unreachable record is `connection_not_ready`.
- **Gateway and payloads (9).** The signed `GET /internal/local-model`, the example payloads, and 7 rejected payload shapes.
- **Changed.** Account deletion skips the local record's engine disconnect.

**Engine tests (6 new):** configuration rules for `LOCAL_LLM_URL`; listing and caching; unreachable and unconfigured servers; a streamed test message with and without a key (the placeholder `unused` when none is set); keys, sign-ins and disconnect refused or harmless for `local`.

**Frontend tests (1 new):** account error codes reach the reducer, `needsConnectionFix` recognises them, and following the run again clears them.

**Browser probe (14/14):**
- **Server up (6).** The card shows **Available**, the address and two models, with no key or disconnect controls. A test message reached the fake server as a streamed `qwen2.5:7b` request. The server was offered and saved in "Use for chat". A new chat's header showed `Ollama on this PC · qwen2.5:7b` and kept it after the (simulated) reply, which had no model label. A conversation started earlier still showed the built-in assistant.
- **Server stopped (3).** **Not answering** with the reason and fixes; the chat choice warned; the chat header turned amber with "not answering" in its tooltip.
- **Server restarted (3).** The card and header recovered on the next visit. No horizontal scroll at 390px width.
- **No `LOCAL_LLM_URL` (2).** **Not set up** with an example address.
- **All phases.** No console errors.

The first probe run found a real bug: Pi refuses to call a provider without an API key, so a keyless server (the normal Ollama and LM Studio setup) failed every test message with "No API key for provider: local". The engine test had always set a key. The engine now sends the placeholder, a new engine test covers it, and the probe passed. The screenshots also led to clearer wording for a server that is down ("not answering" rather than "connect again") and conditional `OLLAMA_HOST` advice.

Not verified: a real Ollama, LM Studio, llama.cpp or vLLM server, and real replies from any connection (task 3.2). Remote CI was not inspected.

## Code and contributor review — 24 October 2026

Reviewed the local changes in `d7bad7e` and `09da496`: connection ownership and request validation, encrypted credentials, signed engine calls, non-secret responses, the chat choice and conversation deletion. Both commits already had descriptive messages and the approved author/committer; they were preserved.

Found and fixed an account-deletion gap in `ac5a7f9`: the existing profile deletion cascaded database records without asking the engine to erase stored credentials. Account deletion now disconnects every owned supported-provider record, including duplicates and unconfigured records that may have a pending sign-in. It requires `not_connected` acknowledgements before deleting the database account. A failure retains the account and signed-in session for retry. Already disconnected providers remain disconnected; credentials are not restored as a rollback.

| Check | Observed result |
| --- | --- |
| Baseline `composer ci:check` on `09da496` | Passed: 210 Laravel tests / 1107 assertions, 21 frontend unit tests, formatting (128 files), lint (92 files), TypeScript, Pint (119 files), PHPStan (88 files) |
| Engine `npm test` | TypeScript build and all 55 tests passed |
| Cleanup regression | Before the fix, tests demonstrated skipped disconnects and account removal without an engine acknowledgement. After the fix, all four new cases pass: all owned records only, failure and retry, refusing an incomplete acknowledgement, and wrong password causing no disconnect |
| Post-fix targeted PHP tests | 32 tests / 342 assertions passed across account cleanup, profile updates, connections and connection gateway tests |
| Post-fix static checks | Pint passed for the three changed/new PHP files; PHPStan reported no errors; `git diff --check` passed |
| Live `php artisan agent:check` | Passed: configured request/credential settings, signed probe reached validation and unsigned probe was rejected; no run or provider request started |
| `php artisan migrate:status` | All nine migrations are applied, including the chat-connection migration. Read-only check; no database migration or deletion was performed during review |
| Attribution and exclusions | Full-history audit passed; both original commits and the cleanup commit use the approved human identity. No prohibited credits or trailers found in the reviewed changes. Hooks and approved identities remain intact; `.claude/` remains ignored/untracked with attribution disabled locally |

The complete baseline suite ran before the PHP cleanup fix; the affected tests and static analysis ran again afterward. The earlier browser probes, production frontend build, npm audits and mutation checks below were not repeated. Real provider login, live replies, token refresh, restart persistence with a real account and concurrent account-deletion/sign-in behavior remain unverified. Task 3.1 stays open. No push or remote CI verification was performed.

## Chat deletion, date sections and OpenCode connections — 24 October 2026

These were requested by the user during task 3.1:
- **Chat.** The sidebar sorts conversations into Today, Yesterday, Previous 7 days and Older. Conversations can be deleted singly or in a multi-select.
- **Connections.** Connections is now its own page in the main menu. It offers OpenCode Go and Zen through an API key, and stores the user's choice of connection and model for chat.

See [chat-ui.md](chat-ui.md), [chat-history.md](chat-history.md), [connections.md](connections.md) and [the contracts](../contracts/README.md#provider-connections). One additive migration (`users.chat_connection_id`, `chat_model`); no dependency or lockfile changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting, lint (92 files), TypeScript, 21 frontend unit tests, Pint (119 PHP files), PHPStan level 7 (no errors), and 210 Laravel tests / 1107 assertions |
| New Laravel tests | 25 (details below) |
| Engine `npm test` | 55 tests passed (details below) |
| Frontend unit tests | 3 new date-section tests: day boundaries at midnight, the seven-day edge, empty sections, kept order, future and unreadable timestamps |
| Browser probe | 13/13 passed against the task's engine image and a worktree server with seeded SQLite data, on an internal Docker network without internet access (details below) |
| Visual review | Screenshots of the sections, delete dialog, selection mode, Connections page, connected OpenCode card, chat choice and phone layout were inspected. The chat-choice selects were widened |

**New Laravel tests:**
- **Deletion (7).** Single and bulk deletion, owner-only, foreign IDs ignored, validation, stopping a running reply and freeing the slot, an untouched reply in another conversation, and a conversation deleted mid-stream ending with `conversation_deleted` and no save.
- **Connections page (15).** Three providers shown without records created, engine states, the ChatGPT flows, OpenCode keys passing through unchanged and never kept, key validation without old input, method mismatches as 404, the test-message flash, re-authentication, the chat choice with its checks and its reset on disconnect, and per-user isolation.
- **Gateway (1).** The signed key `PUT`.

**Engine tests (55 passing):**
- An OpenCode key is stored encrypted, used as the request key with a session ID, replaced, and removed on disconnect.
- Keys and sign-ins are refused for the wrong providers by both the schemas and the manager.
- The ambient-key guard now also covers `OPENCODE_API_KEY` against Pi's real OpenCode providers.

**Browser probe (13/13):**
- Sections as expected.
- Deleting from the menu with a confirmation.
- Deleting the open conversation from the header, returning to a new chat with the emptied section gone.
- Select, title-click toggling, Select all, Clear and deleting two.
- The deletions persisting after a reload.
- Connections links in the main menu and the chat sidebar, the old address redirecting, and the item gone from Settings.
- Three cards.
- OpenCode Go: a rejected key, then a saved key that never appeared in the page; the free `beam-free` test model failing with "Connection error." on that card only.
- Chat set to OpenCode Go with `beam-free`; removing the key returned chat to the built-in assistant.
- A 390px phone width without horizontal scroll; no console errors.

The first probe run passed 11/13 because of a wrong count in the probe itself (5 conversations remained, not 4). The application behaved correctly, which a step-by-step trace confirmed.

Not verified: real OpenCode keys and replies, a real ChatGPT sign-in, and using the chat choice for replies (task 3.2). Remote CI was not inspected.

## Task 3.1 — 24 October 2026 (implementation; live sign-in pending)

Implemented ChatGPT subscription sign-in. It consists of the engine's `ConnectionManager`, the encrypted per-connection `CredentialVault` and installation ID, six signed connection endpoints with strict v1 schemas, Laravel's `ConnectionGateway`/`SubscriptionConnections`, and the **Settings → Connections** page. See [connections.md](connections.md) and [the contracts](../contracts/README.md#provider-connections).

Compose now publishes `127.0.0.1:1455` and adds the `agent-data` volume. `.env` gains `AGENT_CREDENTIAL_KEY` and `ASSISTANT_CONNECTION_TEST_MODEL`. No dependency, lockfile or migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (117 files), lint (83 files, no warnings), TypeScript, 18 frontend unit tests, Pint (112 PHP files), PHPStan level 7 (82 files, no errors), and 198 Laravel tests / 971 assertions |
| New Laravel tests | 41 tests across three groups (details below) |
| Engine `npm test` | 53 tests passed (19 new, details below) |
| Mutation checks | Giving Pi its default auth context again failed exactly the ambient-key test. Removing the paste pre-check failed exactly the pasting-mistakes test |
| npm audit | 0 vulnerabilities for the application and the engine |
| `npm run build` | Passed |
| Browser probe, sign-in | 8/8 passed against the task's engine image and a worktree server with SQLite data, on an internal Docker network without internet access (details below) |
| Callback listener | Probed during a sign-in on the engine's port 1455: a forged `state` got 400 and the sign-in kept waiting, a wrong path got 404, and after cancelling the port was closed. Engine logs contained only connection IDs and outcomes |
| Browser probe, connected | 4/4 passed with an invented credential stored for the probe user (details below) |
| Visual review | Screenshots of the not-connected, waiting, refused-paste, phone, cancelled, connected and test-failed states were inspected; no defects found |

**New Laravel tests:**
- DTO parsing against the shared examples (23 cases).
- The signed connection gateway: signed targets with the query, exact bodies, engine messages and invalid responses (7).
- The settings page and actions (11): access control, the record created once, engine unavailable or unconfigured, paste sign-in mirroring `connected`, browser-completed sign-in, inline refusals, the pasted address not kept as old input, the cancel window, the test result flash, `reauth_required`, disconnect, and per-user connections.

**New engine tests:**
- **Vault.** Round trip, encryption and private permissions, a swapped file or another key unreadable, replacement after that, serialized writes, a failed write.
- **Installation ID.** Stable across concurrent first calls.
- **Sign-in flows.** A fake Pi provider mirrors Pi's ChatGPT flow: pasted and browser sign-ins, pasting mistakes refused while waiting, one sign-in at a time, failures, expiry, the test message using the stored token, refresh, `reauth_required` without a model call, disconnect, unreadable files, routes and contracts.
- **No silent API billing.** The real OpenAI provider never uses `OPENAI_API_KEY`; a control showed Pi's default context would.

**Sign-in browser probe:**
- The settings link and a new user's "Not connected" state.
- The real sign-in address from Pi: `auth.openai.com/api/accounts/authorize`, `dynamic_agent_client`, `agent_name_hint=Assistant Foundation`, an installation `urn:uuid`, the `127.0.0.1:1455` redirect and PKCE.
- Polling only the connection prop.
- A pasted address from another sign-in refused inline, with the error staying while polling continued.
- 390px phone width without horizontal scroll.
- Cancel notice and polling stopped.
- No console errors.

**Connected browser probe:**
- "Connected" with 42 models and `gpt-5.4-mini` preselected.
- The test message reported "Connection error." as a failed test, because the network had no internet.
- Disconnect asked for confirmation, removed the file and showed the toast.
- The engine data directory was `0700` and the installation ID `0600`.

The first sign-in probe passed 6/8 and found a real defect: the refused-paste error never appeared. A poll reload that ran during the paste either took the action's flashed errors or overwrote the session when it finished. The fix pauses polling while a sign-in form submits, and gives the page and its sign-in actions Laravel's session lock (`->block(15, 15)`). Afterwards 8/8 passed, and the error stayed through later polls. The same run measured about 4 seconds per request on the probe server while its workers warmed up, so polling runs about every 6 seconds there.

A Laravel test also found that a form request's `$dontFlash` is ignored: old input is flashed by the exception handler. `redirect_url` is now registered in `bootstrap/app.php`.

Not verified: the live sign-in with a real ChatGPT account, eligibility, which models a plan may call, the real token lifetime and refresh, a real test reply, and a browser on another host using the paste step against OpenAI. These complete task 3.1 and are recorded in [the provider matrix](provider-matrix.md) when done. Remote CI was not inspected.

## Task 2.4 — 23 October 2026

Implemented the simulated reply stream: engine execution and event stream, the Stage A Laravel relay, server-side saving, Stop and the browser hook with safe Markdown. Behavior and protocol are described in [chat-ui.md](chat-ui.md) and [contracts/README.md](../contracts/README.md). Added `react-markdown` ^10.1.0 and `remark-gfm` ^4.0.1. The lockfile gained 99 packages and lost none, with no version changes; `@types/estree` and `dequal` are now also production dependencies. No migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (103 files), lint (81 files, no warnings), TypeScript, 18 frontend unit tests, Pint (100 PHP files), PHPStan level 7 (74 files), and 157 Laravel tests / 756 assertions |
| New Laravel tests | 35: strict event parsing (15 cases); the signed NDJSON reader (query in the signed target, heartbeats, terminal stop, resume cursor, malformed and out-of-order events, early end, engine errors); relay admission, one reply per user, ownership, SSE output with IDs, single idempotent save, resume, cancelled/failed runs saving nothing, resumable interruption, contract violation freeing the slot, Stop, and `active_run` on the page |
| Engine `npm test` | 34 tests passed (12 new): deterministic Markdown answer, lossless chunks, contract-valid events whose deltas equal the final text, cancellation, deadline, event limit, replay and resume, live following, Stop during a stream, no second execution for a duplicate admission, signed and validated stream requests |
| Frontend unit tests | 8 new reply-reducer tests: delta accumulation, final text replacing the draft, replayed events applied once, resumable and final stream errors, Stop confirmation, a late Stop not reopening a completed reply, following the same or a new run |
| npm audit | 0 vulnerabilities for the application and the engine |
| `npm run build` | Passed; the chat page chunk is now 191 kB (58 kB gzip), up from 25 kB (8.8 kB gzip) because of the Markdown parser |
| Stream timing | Laravel's gateway received engine events as paced (about every 60 ms), not buffered. In the browser, Chrome DevTools recorded each relayed SSE delta about 250 ms apart, matching the engine pace, with about 37 ms between the final text and the saved completion |
| Browser probe | 11/11 passed against a worktree engine (250 ms simulated chunks) and server with SQLite data: incremental draft (13 growth steps); final reply shown once with bold, list, quote and code block; saved and not duplicated after reload; an `<img onerror>` and a `javascript:` link in a message neither ran nor rendered; Stop showing "Stopped" and saving nothing; reload mid-reply resuming and saving once; closing the tab mid-reply still saving the reply; a new chat streaming its first reply on its own page; 390px mobile with a code block not overflowing; dark mode; no console errors |
| Visual review | Screenshots of a reply, a stopped reply, mobile and dark mode were inspected. Two issues were fixed and re-checked: the "Stopped" label had stayed below the visible area, and a removed unsafe link still rendered as an empty link |

The first browser run passed 8/11 and appeared to show buffered streaming. Timing showed that every request to the probe server took about 3.6 seconds, even `GET /up`, so a 1-second simulated reply had finished before its stream opened. The relay then correctly replayed it. With OPcache enabled for PHP's CLI server, warm requests took 220–440 ms, and the paced reply streamed live. The running development container uses the same CLI server with `opcache.enable_cli=0`; its `GET /up` took 3.0 s, 1.0 s and 0.12 s on three tries. Enabling OPcache there is an optimization suggestion and was not changed in this task.

Not verified: real provider replies, physical phone keyboards and IMEs, screen-reader output, several concurrent users, a proxy in front of the event stream (Laravel sends no heartbeats to the browser yet), and an engine restart during a reply. Replies longer than MySQL's `TEXT` limit (65,535 bytes) would fail to save. The simulated replies are far shorter, but real models may not be, so the `messages.content` column needs widening before task 3.2. Remote CI was not inspected.

## Task 2.3 — 23 October 2026

Implemented the chat page; behavior and files are described in [chat-ui.md](chat-ui.md). No dependency, lockfile or migration changed. `composer ci:check` now also runs the frontend unit tests (Vitest bundled with Vite+).

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (99 files), lint (77 files, no warnings), TypeScript, 10 frontend unit tests, Pint (93 PHP files), PHPStan level 7, and 122 Laravel tests / 636 assertions |
| New Laravel tests | `ChatPageTest`, 6 tests: guest and unverified redirects; owner-only list order; next page through the JSON list; latest 50 messages in order with the cursor and a matching JSON older page; private fields absent; another user's and malformed IDs 404. The existing 18 history tests still pass after their controller moved its queries into `ConversationRepository` |
| Frontend unit tests | 10 tests: Enter, Shift+Enter, other keys, `isComposing`, composition flag, keyCode 229, blank drafts, code-point limits with emoji, title shortening on grapheme boundaries |
| `npm run build` | Passed; the chat page chunk is 25.1 kB (8.8 kB gzip) |
| Browser probe | 31/31 checks passed with Playwright 1.64.1 against a built worktree server backed by its own SQLite file and invented data. Chromium desktop: empty state, first-message conversation creation and navigation, Shift+Enter/Enter, synthetic and CDP IME composition, Safari keyCode 229, failed-save alert with draft restored, over-length limit, opening at the bottom, earlier messages with the anchor moving 0px, indentation and long-token wrapping, 12px message spacing, copy success and the no-clipboard failure state, sidebar rename (no leftover pointer lock), dark/light theme, sidebar collapse, accessible names on every button and link. Chromium mobile (390×844, touch): no horizontal overflow, composer inside the viewport, Sheet navigation closing after selection, Enter sending. Firefox and WebKit: the four keyboard/IME checks |
| Visual review | Light and dark desktop screenshots and mobile screenshots were inspected. The first probe run showed oversized gaps between messages; actions now sit beside user bubbles, and the probe measures the gap |
| Console | No unexplained errors. Explained notes: the deliberate simulated 500, a Firefox font download aborted by fast navigation, and WebKit ignoring the `interactive-widget` viewport hint |

The probe used `http://localhost` inside the server's network namespace, so the Clipboard API was available as it is at `http://localhost:8080`. On a plain-HTTP non-localhost origin, copy now reports "Copy failed" instead of doing nothing. The CDP IME simulation also inserted a newline after the composed text; a real IME consumes the confirming Enter, which needs a physical-device check.

Not verified: physical iOS/Android keyboards and real IMEs, screen-reader output, and the running development services (the probe used the task branch worktree). Remote CI was not inspected. Optimization: the page loads 25 conversations and 50 messages initially; measure before adding virtualized lists.

## Publication review — 23 October 2026

Reviewed task 2.2 at `8e29e53`, including ownership checks, serialization, HMAC signing and verification, bounded request reading, strict schemas, duplicate/cancellation handling, setup and private networking. No blocking implementation defect was found. Corrected the server comment and handoff to describe the actual authentication order: header checks precede the bounded body read; signature verification precedes JSON parsing. Clarified that engine admission exists while Laravel run admission and message-write idempotency remain future work. No runtime behavior changed.

| Check | Observed result |
| --- | --- |
| `docker compose exec --user sail laravel.test composer ci:check` | Passed: formatting (87 files), lint (64 files), TypeScript, Pint (91 files), PHPStan (70 files), and 116 Laravel tests / 561 assertions |
| `docker compose exec agent npm test` | TypeScript build and all 22 engine tests passed |
| `docker compose exec --user sail laravel.test php artisan agent:check` | Passed against the running services: signed probe accepted for validation, unsigned probe rejected; no run admitted |
| Contributor review | Complete-history attribution audit passed. All nine existing commits use the approved human author and committer. No co-author trailer or prohibited contributor credit was found in the task 2.2 changes; attribution settings, approved identities and hooks remain unchanged |
| Tracked-file review | No `.env`, downloaded dependencies or generated build output is tracked; the local request-signing secret is absent from the changed tracked files |
| Publication | `main` fast-forwarded to `development`; both remote branches accepted all four pending commits through `8e29e53` in one atomic push. No history rewrite |

Remote CI results were not inspected. Earlier mutation, dependency-audit and live run-admission results below remain dated implementation evidence; they were not repeated in this review. Tasks 2.3–2.4 remain unimplemented. Admission is still process-local and no provider/model execution exists.

## Task 2.2 — 23 October 2026

Implemented versioned private engine contracts and signed Laravel-to-engine calls; the contract is documented in [contracts/README.md](../contracts/README.md). The engine now declares `typebox` 1.3.27 directly. It was already installed through Pi, and the lockfile's resolved tree is unchanged apart from that root entry. No PHP dependency or migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: frontend formatting/lint (64 files) and types, Pint (91 PHP files), PHPStan level 7 (70 files), and 116 Laravel tests / 561 assertions |
| New Laravel tests | 58 tests / 125 assertions: shared signing vector; snapshot serialization identical to the shared example; PHP bounds compared with the schema; 16 invalid-snapshot cases; signed payload, headers and target; engine error codes and details; 7 out-of-contract responses; transport and bare-5xx failures; missing/short key sending nothing; cancel path signing; owned-history snapshots, history bounds, cross-user conversation (404) and forged connection refusal; `not_configured` connections refused for live models; no private fields sent; `agent:check` outcomes |
| Engine `npm test` | Passed: 22 tests covering shared examples, signing vector, schema strictness, health, missing/wrong-key/expired/future/malformed signatures, cross-endpoint and body tampering, content type, JSON, contract version, bounded details, semantic rules, model/capability refusal, body limit, bounded registry expiry, idempotent admission, conflicting reuse and cancellation |
| Signing vector | Computed independently with OpenSSL and Node before either implementation existed; both runtimes reproduce it in tests |
| Mutation check | Making engine signature comparison always succeed failed the two signature tests |
| Live cross-container probe | A temporary engine built from this commit joined the Compose network with no host port. Laravel's `PiGateway` received: 202 accepted; 202 duplicate on identical resubmission; 409 `conflicting_duplicate`; 422 `model_unavailable` for an unverified provider; 422 `unsupported_capability`; 202 `cancel_requested`, then duplicate; 404 `run_not_found` |
| `php artisan agent:check` | Passed with the matching key (signed probe reached validation, unsigned probe got 401). Failed with exit 1 and `authentication_failed` for a different key; the engine logged `missing` and `mismatch` reasons only |
| Engine npm audit | 0 vulnerabilities |
| Compose configuration | `docker compose config` valid; engine receives the key/simulation variables, a read-only `/contracts` mount and the `contracts` build context; still no published port |
| Setup key generation | The `setup.ps1` replacement logic, run on a scratch copy of `.env.example`, produced one 64-character key and preserved it on a rerun |
| Running development services | After `2e8b62d` reached `development`: a generated 64-character key was added to the ignored `.env` without printing it. `docker compose up -d --build agent` became healthy with `PortBindings` `{}`. `agent:check` passed, the engine's 22 tests passed in the running `agent` container, and 116 Laravel tests / 561 assertions passed in `laravel.test` |

The checks above the last row ran against the task branch worktree in disposable containers, without changing the running development services. The live probe used a temporary key and a temporary engine container that was stopped afterwards. No model or provider was called, and nothing persists between engine restarts. Remote CI was not triggered.

Not verified: overlapping-key rotation, behavior under concurrent admission load, and any engine-to-Laravel callback (none exists). The Windows filesystem optimization noted below still applies. Next are tasks 2.3 (chat page) and 2.4 (simulated stream).

## Task 2.1 — 23 October 2026

Implemented owned conversations/messages and non-secret provider connection metadata; the public endpoint contract is in [chat-history.md](chat-history.md). No runtime dependency or lockfile changed.

| Check | Observed result |
| --- | --- |
| `php artisan wayfinder:generate --with-form` | Passed; generated route/action types for the new endpoints; generated files remain ignored |
| `composer ci:check` | Passed: frontend formatting/lint/types, Pint (77 PHP files), PHPStan level 7 (61 files), and 58 Laravel tests / 436 assertions |
| New history tests | 18 tests / 298 assertions within the complete suite: owner save/load, guest/unverified denial, CSRF denial/acceptance, cross-user and nested-parent isolation, forged fields, private-field exclusion, pagination links/cursors, text bounds/whitespace, account cascades, sequence uniqueness and transactional rollback |
| MySQL migration preview and apply | Three additive migrations passed: provider connections, conversations, messages; existing authentication tables were preserved |
| MySQL fixture probe | Passed: 12,000 four-byte characters round-trip, ordered appends, database duplicate-sequence rejection, connection unlinking with retained messages and account deletion cascading through associated records |
| Local data preservation | Fixture changes were rolled back; a fingerprint of existing user rows matched before migration and after verification; no default/test account remains |
| Laravel → Pi | Existing private health check still returns `status: ok` and `providerAuth: not_configured` |

Tests use isolated SQLite memory databases. The separate MySQL probe ran inside a transaction against the local development service, retained under ignored `.setup/verify-history.php` with its non-secret baseline fingerprint. It refuses non-local/non-MySQL environments and rolls back fixture changes in `finally`. It did not reset the database or remove a volume. The three actual schema migrations remain installed; only the temporary fixture was rolled back.

The regression suite covers the existing authentication/settings flows. The frontend's lint/types and generated route types were checked; the compiled frontend and unchanged engine test suite were not rebuilt/rerun in this task. The prior browser/build/engine results below remain dated Phase 1 evidence. Concurrent append load testing, real provider authentication, chat UI/streaming and durable run admission/replay are not verified. Remote CI was not inspected or triggered by a new push. Task 2.2 is next.

Optimization: history reads use the unique conversation/sequence index and a numeric boundary for older pages; list reads avoid total counts and have explicit bounds. Measure list-query cost before replacing offset pagination with cursors. The Windows filesystem optimization noted below still applies.

## Phase 1 — 22 October 2026

Date: 22 October 2026. Environment: Windows checkout, Docker Desktop Linux/WSL2 engine, pinned runtimes in [runtime-versions.md](runtime-versions.md).

## Observed results

| Check | Result |
| --- | --- |
| PHP and agent Docker builds | Passed, including required PHP extensions and the agent TypeScript build |
| `composer validate --strict --no-check-publish` | Passed; manifest and lockfile agree |
| `composer audit` | No vulnerability advisories |
| Frontend and agent npm installation/audit | Both report zero vulnerabilities |
| `npm run build` | Passed; browser assets, fonts and manifest generated |
| `npm run types:check` | Passed |
| `npm run check` | Passed: 72 formatted files, 64 linted files, zero warnings/errors |
| `composer test` | Passed: Pint (55 files), PHPStan level 7 (40 files, no errors), PHPUnit 40 tests / 138 assertions |
| `docker compose run --rm --no-deps agent npm test` | Passed: 3 tests covering Pi imports/readiness, rejecting writes to health, and rejecting execution before authenticated contracts exist |
| MySQL migrations | All five starter migrations passed on MySQL 8.4.13 |
| MySQL restart persistence | A uniquely named temporary user survived a normal MySQL container restart; its ID/email were verified, then only that fixture was deleted |
| Laravel → Pi | Laravel's HTTP client successfully called configured `http://agent:3101/internal/health` and received `status: ok`, `providerAuth: not_configured` |
| Private engine port | Docker's `HostConfig.PortBindings` is `{}`; no agent port published |
| Compose health | Laravel, MySQL and agent all healthy after startup/restart |
| Browser login | `http://localhost:8080/login` renders the styled React form; no browser console warnings/errors |
| Development server | Documented `npm run dev` command starts; login and `http://localhost:5173/@vite/client` both return HTTP 200; server stopped after the check |
| Setup script | PowerShell syntax checked; its build/install/key/migrate/start commands were exercised during setup |

PHP tests use SQLite in memory and do not prove MySQL behavior. The separate live MySQL fixture check above supplies the Phase 1 persistence evidence. The one-off probe is retained under ignored `.setup/verify-foundation.php`; it refuses non-local/non-MySQL environments, records the exact fixture ID/email and cleans up its fixture record. No default account remains in the database.

## Changes and implementation decisions

- Imported the pinned official React starter while preserving the blueprint, build plan and download records. Retained the starter's registration, email verification, password reset/confirmation, two-factor and passkey features. Removed its one-time feature-install scaffolding after successful configuration.
- Added `compose.yaml`, the pinned Sail-compatible `docker/php/` image, `.env.example` defaults, `config/assistant.php` and `scripts/setup.ps1`. Local secrets were generated only in ignored `.env`. MySQL uses a project-specific volume and no host port.
- Added `agent-service/` with its separate manifest/lockfile, minimal private health server, TypeScript configuration, tests and development image. Pi imports are real; provider requests are not implemented or simulated as successful.
- Generated all three dependency lockfiles. Replaced the starter's vulnerable Vite+ 0.3.x tooling with 1.3.0 and its matching Vite alias/override; no forced audit fix or ignored platform requirements were used.
- Added Windows watcher polling, excluded setup caches/engine files from the frontend/PHP formatters, removed the starter's known seeded account, and added the Pi checks to CI. CI is configured but has not run on a remote host.
- Documented startup, shutdown, private ports, development scripts, verification and optimization in the README/setup/runtime/build-plan files. The prerequisite record remains in `docs/prerequisites.md`.

## Limits and next work

The successful frontend build took about 156 seconds on this Windows bind mount; Tailwind's transform accounted for about 125 seconds. Composer extraction and first PHP checks were also slow. Move the single authoritative checkout to Ubuntu's Linux filesystem after its user/Docker integration is ready to improve filesystem performance. This is a development observation, not an application throughput benchmark.

The build emits a non-fatal warning that optional `fontaine` is absent, so optimized font fallbacks are unavailable. Font assets still build and the browser renders correctly. No additional font dependency was added solely to silence it.

The full setup script has not been exercised from a separate pristine checkout; Phase 6.3 retains that acceptance check. Its constituent setup steps passed here. No production deployment, backup/restore, physical passkey enrollment, external email delivery or live provider test was performed. Provider authentication remained unconfigured at this checkpoint. Task 2.1 was next after Phase 1; see the newer dated record above and the handoff for current progress.
