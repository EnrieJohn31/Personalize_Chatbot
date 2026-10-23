# Chat page and replies — tasks 2.3–2.4

Implemented: 23 October 2026. The signed-in chat interface over the task 2.1 history endpoints (task 2.3), with replies streamed from the engine through Laravel (task 2.4). In development the engine's deterministic simulated provider writes the replies; chat calls no model until task 3.2 uses the ChatGPT connection from [task 3.1](chatgpt-connection.md).

## Routes and data

| Route | Result |
| --- | --- |
| `GET /chat` | New chat with the first 25 owned conversations, newest activity first |
| `GET /chat/{conversation}` | One owned conversation with its latest 50 messages; another user's or a malformed ID returns 404 |

Both routes use the `auth` and `verified` middleware and render the Inertia page `chat/index`. `ChatPageController` builds the initial props with the same resources and `ConversationRepository` queries as the JSON endpoints, so page props and API responses have identical shapes. `conversations.next_page_url` is a relative link to `GET /api/chat/conversations`. `active_run` is the user's unfinished reply, if any, so a reloaded or newly opened page resumes its stream.

After the first render, the page uses the `/api/chat` endpoints described in [chat-history.md](chat-history.md) through `resources/js/lib/chat-api.ts`. That module uses Inertia's HTTP client, which sends the XSRF cookie as `X-XSRF-TOKEN` for same-origin requests. API failures become short, user-facing messages; 419 asks for a reload, 422 shows the server's first validation message, and the run endpoints' 409/502/503 messages are shown as sent.

## Replies: Stage A relay

`ChatRunController` is a labelled Stage A prototype: Laravel admits a run with the engine and relays its events to the browser. Durable runs, claims and a persisted event store replace it in Phases 4–5.

| Request | Result |
| --- | --- |
| `POST /api/chat/conversations/{conversation}/runs` | `202` with `{id, conversation_id, events_url}`. Builds the run with `RunRequestFactory` from the owner's history and submits it through `AgentGateway`. `409 no_pending_user_message` if the latest message already has a reply, `409 run_in_progress` (with the active run) while another reply is being written, `503 assistant_unavailable` when the engine has no usable provider, and `502`/`503 engine_unavailable` when it cannot be reached |
| `GET /api/chat/runs/{run}/events` | `text/event-stream` for the run's owner; `404` for anyone else; `204` once the run has finished |
| `DELETE /api/chat/runs/{run}` | `202 cancel_requested`; the engine ends the run with `run.cancelled` |

- **One reply per user.** `ActiveRuns` keeps a cache-backed slot per user (Blueprint section 12) and records who owns each run. Entries expire with the run deadline plus a minute. They are cleared when a run finishes, or when admission fails.
- **Server-sent events.** Each engine event is relayed as `id: <engine sequence>`, `event: <type>`, `data: {"runId": …, …}`. `run.completed` carries the saved message instead of empty data. The browser's `EventSource` resumes with `Last-Event-ID` after a dropped connection. The relay always reads the engine stream from the start, so it knows the final text, and forwards only events after that ID. Relay problems use a separate `stream.error` event with `{code, message, resumable}` and no ID.
- **Saving.** When the relay sees `run.completed`, it saves `assistant.final` through `ConversationRepository::appendAssistantMessage`. That method is idempotent per run (`canonical_content.run_id`), so several readers save one message. The relay ignores the browser disconnecting, so a reply is still saved if the tab closes once its stream has opened. A run whose stream nobody opens is not saved; opening the conversation within the run's retention resumes and saves it. Cancelled or failed runs save nothing.
- **Failures.** An interrupted engine stream is resumable: the browser reconnects automatically and shows "Reconnecting…". A contract violation is not resumable: the relay asks the engine to stop the run and frees the user's slot.

## Behavior

- **Sending.** On `/chat`, the first message creates a conversation, saves the message and starts the reply, then opens `/chat/{id}`, which resumes the stream. The title is the message's first line, shortened to 60 code points on a grapheme boundary. In an existing conversation, the message appears as "Sending…" until saved, and its reply then streams below it. A failed save removes the message, restores the draft (unless a new one was started) and shows an alert. Sending is disabled while a reply is being written.
- **Replies.** `hooks/use-chat-run.ts` owns admission, the `EventSource`, Stop and the final message. The reducer in `lib/chat-run-state.ts` appends deltas to a draft, ignores events it has already applied, and replaces the draft with the final text; the saved message then replaces the draft in the same render. While a reply is starting it shows "Preparing a reply…", then "Writing…". Stop shows "Stopping…" until the engine confirms, then labels the partial text "Stopped". A failed reply shows "Not completed" with the error.
- **Get a reply.** Whenever the latest saved message is the user's and no reply is running, the page offers "Get a reply" (or "Retry reply" after an error). It starts a new run for that message, or reconnects to a resumable one. It never saves the message again.
- **Markdown.** Assistant replies render through `react-markdown` with GitHub-flavoured Markdown. Raw HTML is shown as text, never rendered. Unsafe link targets such as `javascript:` are removed, and the link becomes plain text. Links open in a new tab with `noopener noreferrer nofollow`. A person's own messages are shown exactly as typed.
- **Keyboard.** Enter sends and Shift+Enter inserts a line. Nothing sends during an input-method composition: `isComposing`, composition events and Safari's keyCode 229 confirming Enter are all respected. The rules live in `resources/js/lib/chat-composer.ts` with unit tests.
- **Limits.** Drafts follow the server: blank text cannot be sent, and the 12,000-character limit counts code points like PHP's `mb_strlen`. A counter appears at 90% and an over-length draft is marked invalid. Titles allow 200 characters.
- **Transcript.** The view follows new messages, a growing reply and its status changes only while the reader is within 80px of the bottom, or after they send. "Load earlier messages" fetches the previous page and keeps the reading position.
- **Navigation.** A collapsible conversation sidebar (off-canvas on desktop, a Sheet on mobile) with New chat, the conversation list, "Show more conversations", per-conversation Rename and the existing user menu. The main app sidebar has a Chat link.
- **Header.** Sidebar toggle, title, Rename for an existing conversation and a Light/Dark/System theme menu backed by the existing appearance setting.
- **Accessibility.** Icon-only controls have labels and tooltips, messages carry screen-reader speaker labels, and a polite status region announces sending, reply progress ("The assistant is replying", "Reply complete", "Reply stopped"), renames and failures. It never reads the streamed text. A reply being written is marked `aria-busy`. Errors use `role="alert"`.
- **Mobile.** The page is a full-height flex column, so the composer stays at the bottom. The viewport meta adds `interactive-widget=resizes-content`, which lets Chrome on Android shrink the layout above the on-screen keyboard. Safari ignores the hint and logs a console note. Upload controls are not shown.

## Not included yet

Real model replies (task 3.x), tool use, reply editing or regeneration, message or conversation deletion and uploads. User-message writes are still not idempotent: retrying after an ambiguous network failure can save the same text twice (see [chat-history.md](chat-history.md)). Durable execution independent of any reader, server-side event retention, interruption detection after an engine restart, and heartbeats from Laravel to the browser arrive with Phases 4–5.

## Main files

| Path | Responsibility |
| --- | --- |
| `app/Http/Controllers/ChatPageController.php` | Page routes, initial props and `active_run` |
| `app/Http/Controllers/ChatRunController.php` | Stage A run admission, SSE relay, saving and Stop |
| `app/Services/Chat/ActiveRuns.php` | Cache-backed run ownership and the one-reply-per-user slot |
| `app/Services/Chat/ConversationRepository.php` | Shared list/history paging and the idempotent assistant-message save |
| `app/Data/Agent/RunEvent.php`, `app/Services/Ai/PiGateway.php` | Strict engine event parsing and the signed NDJSON stream reader |
| `resources/js/pages/chat/index.tsx` | Page state: send, create, replies, earlier history and rename |
| `resources/js/hooks/use-chat-run.ts`, `lib/chat-run-state.ts` | One reply at a time: EventSource, Stop and the tested reply reducer |
| `resources/js/components/chat/` | Sidebar, header, message list, message, Markdown, composer and rename dialog |
| `resources/js/hooks/use-conversations.ts` | Sidebar list, later pages and renames |
| `resources/js/lib/chat-api.ts`, `chat-composer.ts` | API calls and testable composer rules |
| `tests/Feature/Chat/ChatPageTest.php`, `ChatRunTest.php`, `tests/Feature/Agent/PiGatewayEventsTest.php`, `tests/Unit/Agent/RunEventTest.php`, `resources/js/lib/*.test.ts` | Page, relay, gateway, event and frontend rule tests |

## Checks

```powershell
docker compose exec --user sail laravel.test npm run test        # composer and reply rules (Vitest through Vite+)
docker compose exec --user sail laravel.test php artisan test --filter=Chat
docker compose exec agent npm test                               # engine simulation and event stream
docker compose exec --user sail laravel.test composer ci:check   # includes npm run test
```

Browser behavior was checked with Playwright probes; see [validation.md](validation.md). They are kept in the ignored `.setup/` folder and are not yet part of CI.
