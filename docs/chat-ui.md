# Chat page — task 2.3

Implemented: 23 October 2026. The signed-in chat interface over the task 2.1 history endpoints. It saves user messages only; assistant replies, streaming and Markdown arrive with task 2.4.

## Routes and data

| Route | Result |
| --- | --- |
| `GET /chat` | New chat with the first 25 owned conversations, newest activity first |
| `GET /chat/{conversation}` | One owned conversation with its latest 50 messages; another user's or a malformed ID returns 404 |

Both routes use the `auth` and `verified` middleware and render the Inertia page `chat/index`. `ChatPageController` builds the initial props with the same resources and `ConversationRepository` queries as the JSON endpoints, so page props and API responses have identical shapes. `conversations.next_page_url` is a relative link to `GET /api/chat/conversations`.

After the first render, the page uses the `/api/chat` endpoints described in [chat-history.md](chat-history.md) through `resources/js/lib/chat-api.ts`. That module uses Inertia's HTTP client, which sends the XSRF cookie as `X-XSRF-TOKEN` for same-origin requests. API failures become short, user-facing messages; 419 asks for a reload, and 422 shows the server's first validation message.

## Behavior

- **Sending.** On `/chat`, the first message creates a conversation and then saves the message, then opens `/chat/{id}`. The title is the message's first line, shortened to 60 code points on a grapheme boundary. If saving fails after the conversation was created, the next attempt reuses that conversation. In an existing conversation, the message appears as "Sending…" until saved. A failure removes it, restores the draft (unless a new one was started) and shows an alert. Only one send runs at a time.
- **Keyboard.** Enter sends and Shift+Enter inserts a line. Nothing sends during an input-method composition: `isComposing`, composition events and Safari's keyCode 229 confirming Enter are all respected. The rules live in `resources/js/lib/chat-composer.ts` with unit tests.
- **Limits.** Drafts follow the server: blank text cannot be sent, and the 12,000-character limit counts code points like PHP's `mb_strlen`. A counter appears at 90% and an over-length draft is marked invalid. Titles allow 200 characters.
- **Transcript.** Messages render as plain text with whitespace preserved. The view follows new messages only while the reader is within 80px of the bottom, or after they send. "Load earlier messages" fetches the previous page and keeps the reading position.
- **Navigation.** A collapsible conversation sidebar (off-canvas on desktop, a Sheet on mobile) with New chat, the conversation list, "Show more conversations", per-conversation Rename and the existing user menu. The main app sidebar gains a Chat link.
- **Header.** Sidebar toggle, title, Rename for an existing conversation and a Light/Dark/System theme menu backed by the existing appearance setting.
- **Accessibility.** Icon-only controls have labels and tooltips, messages carry screen-reader speaker labels, and a polite status region announces sent, renamed and failed actions without reading message text. Errors use `role="alert"`.
- **Mobile.** The page is a full-height flex column, so the composer stays at the bottom. The viewport meta adds `interactive-widget=resizes-content`, which lets Chrome on Android shrink the layout above the on-screen keyboard. Safari ignores the hint and logs a console note. Upload controls are not shown.

## Not included yet

Assistant replies, streaming, Markdown, Stop, message editing or deletion, conversation deletion and uploads. Message writes are still not idempotent: retrying after an ambiguous network failure can save the same text twice (see [chat-history.md](chat-history.md)). Task 2.4 must coordinate message persistence with run submission.

## Main files

| Path | Responsibility |
| --- | --- |
| `app/Http/Controllers/ChatPageController.php` | Page routes and initial props |
| `app/Services/Chat/ConversationRepository.php` | Shared conversation list and history paging |
| `resources/js/pages/chat/index.tsx` | Page state: send, create, earlier history and rename |
| `resources/js/components/chat/` | Sidebar, header, message list, message, composer and rename dialog |
| `resources/js/hooks/use-conversations.ts` | Sidebar list, later pages and renames |
| `resources/js/lib/chat-api.ts`, `chat-composer.ts` | API calls and testable composer rules |
| `resources/js/components/appearance-menu.tsx`, `ui/textarea.tsx` | Theme menu and shadcn/ui textarea |
| `tests/Feature/Chat/ChatPageTest.php`, `resources/js/lib/chat-composer.test.ts` | Page access/props and composer rules |

## Checks

```powershell
docker compose exec --user sail laravel.test npm run test        # composer rules (Vitest through Vite+)
docker compose exec --user sail laravel.test php artisan test --filter=ChatPageTest
docker compose exec --user sail laravel.test composer ci:check   # now includes npm run test
```

Browser behavior was checked with a Playwright probe; see [validation.md](validation.md). That probe is not yet part of CI.
