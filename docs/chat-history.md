# Owned chat history — task 2.1

Implemented: 23 October 2026. This is the storage foundation for the later chat interface and Pi execution boundary. No model request is started by these endpoints.

## Authentication and ownership

Routes are loaded from `routes/chat.php` through `routes/web.php`, so `/api/chat` uses the existing session, cookies, request-forgery protection and verified-email requirement. Send `Accept: application/json` and use the application's normal CSRF/origin protection for writes. Guests receive 401, unverified accounts 403, inaccessible or mismatched record IDs 404, and invalid input 422.

Laravel derives owners from the signed-in user. Conversation and connection lists query that user's relations. Policies guard conversation reads/updates and connection reads; scoped route binding requires a message to belong to its URL's conversation. Both create and update validate connection ownership. Database relations enforce record existence; application validation enforces that an associated connection has the same owner. Future internal writers must preserve that ownership invariant too.

## Endpoints

All paths below start with `/api/chat`. IDs are server-generated UUIDs.

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /conversations` | Optional `page`, `per_page` | Owned conversation summaries, newest activity first |
| `POST /conversations` | Required `title`; optional nullable `provider_connection_id` | 201 with the saved conversation in `data`. Without `provider_connection_id`, it records the owner's current chat choice as `provider_connection_id`, `model_provider` and `model` |
| `GET /conversations/{conversation}` | Optional `per_page`, `before_sequence` | Conversation in `data`, bounded history in `messages` |
| `PATCH /conversations/{conversation}` | Optional `title`, nullable `provider_connection_id` | Updated summary; null detaches the connection |
| `DELETE /conversations/{conversation}` | None | `{"deleted": [id]}`; the conversation and its messages are gone |
| `DELETE /conversations` | Required `ids`: 1–100 distinct UUIDs | `{"deleted": [...]}`, the IDs among them that the caller owned |
| `POST /conversations/{conversation}/messages` | Required `content` | 201 with an appended user message in `data` |
| `GET /conversations/{conversation}/messages/{message}` | None | One owned, correctly nested message in `data` |
| `GET /provider-connections` | Optional `page`, `per_page` | Owned connection metadata |
| `POST /provider-connections` | Required `provider`, `auth_method` | 201 with metadata and `status: not_configured` |
| `GET /provider-connections/{providerConnection}` | None | Owned connection metadata in `data` |

Titles are required on creation and limited to 200 characters. Message content is nonblank text, limited to 12,000 characters; indentation and trailing newlines are preserved. Clients cannot set a message role, sequence, owner, ID, conversation reference or private canonical content, nor a conversation's `model_provider` or `model`; those record the chat choice when the conversation starts, so a later choice on the Connections page applies to new conversations only. Messages include `model`: the model that wrote an assistant reply, or null for user messages and built-in replies. Browser messages always have role `user`; assistant/tool messages require future trusted server execution paths.

Provider identifiers are lowercase slugs of at most 64 characters. Authentication metadata accepts `oauth`, `api_key` or `none`. These values record intent only: they do not establish provider compatibility, a working login or permission to execute. New records have no credential reference. Credential fields, client-chosen status and ownership are rejected. Only validated fields are written; unrelated extra fields are ignored. Credential references and canonical transcript data are excluded from every public resource and hidden during ordinary model serialization. Actual credentials have no column in these tables.

Connection sign-in, keys, tests and disconnecting live on the Connections page ([connections.md](connections.md)); creating metadata here is not a sign-in action.

Deleting conversations was added on 24 October 2026 (`ConversationDeletion`). It is permanent: messages go with their conversation through the foreign key. Bulk deletion ignores IDs the caller does not own, without revealing whether they exist. A reply still being written for a deleted conversation is cancelled at the engine, and its slot is freed. A relay that finds its conversation gone ends with a `stream.error` of code `conversation_deleted` and saves nothing. Message editing and single-message deletion are not offered. Existing account deletion cascades owned history and connection metadata. Deleting connection metadata at the database layer detaches it from conversations and retains their history; future credential cleanup/disconnect behavior must be integrated with the engine.

## Pagination

Conversation and connection lists default to 25 items, accept 1–100, and return the standard resource `data`, `links` and `meta` envelope. Page numbers range from 1 to 10,000. Follow `links.next`; links retain the validated page size. Lists use stable timestamp/UUID ordering without a total-count query. Activity changes can reorder the conversation list between page requests.

History defaults to the latest 50 messages and permits 1–100 per request. Each page is returned in ascending sequence order for display. Fetch older messages using the returned `next_before_sequence`; null means no older page. New appends do not shift the boundary for older history.

Example history envelope, abbreviated:

```json
{
  "data": { "id": "conversation-uuid", "title": "Sample conversation" },
  "messages": {
    "data": [
      { "id": "message-uuid", "sequence": 4, "role": "user", "content": "Hello" }
    ],
    "next_before_sequence": 4,
    "per_page": 1
  }
}
```

The next request is `GET /api/chat/conversations/{conversation}?per_page=1&before_sequence=4`. The UUID placeholders above are illustrative, not valid request IDs.

## Storage and consistency

Three additive migrations create `provider_connections`, `conversations` and `messages`. Later migrations (24 October 2026) widen `messages.content` to `MEDIUMTEXT`, so long model replies fit in MySQL (user messages keep the 12,000-character limit), and add the nullable `conversations.model_provider` and `model`. The existing authentication tables are preserved. Indexes cover owner/activity queries and the unique `(conversation_id, sequence)` pair. Messages belong to a conversation rather than duplicating an independently assignable owner.

`ConversationRepository::appendUserMessage` locks the conversation row inside a database transaction, assigns the next sequence, inserts the message and updates conversation activity. The unique sequence constraint guards duplicates; a failed activity update rolls back the message. Up to three transaction attempts handle deadlocks. Raw user text is also retained in private canonical content as a role/content pair. Provider-specific assistant/tool transcript metadata must be stored through the future trusted execution path, separately from visible Markdown.

This does not implement request idempotency or a run lifecycle. Retrying a successful message POST creates another message. Task 4.1 will introduce idempotent run admission; the future UI must coordinate message persistence and run admission to avoid saving the same user input twice.

## Verification and next work

`tests/Feature/Chat/HistoryTest.php` covers owner save/load, guest/unverified denial, real CSRF middleware, cross-user and cross-conversation references, forged fields, private-field exclusion, pagination, whitespace and size limits, cascading account deletion, sequence uniqueness and transaction rollback. Run it with:

```powershell
docker compose exec --user sail laravel.test php artisan test --filter=HistoryTest
docker compose exec --user sail laravel.test composer ci:check
```

The default tests use isolated SQLite memory databases. See `docs/validation.md` for the actual results and separate MySQL checks. Concurrent append load testing remains unverified; the locking mechanism and sequence constraint are not a throughput benchmark.

Task 2.2 added `App\Services\Chat\RunRequestFactory`, which turns an owned conversation's latest history into a signed engine request; see [the engine contracts](../contracts/README.md). Task 2.3's [chat page](chat-ui.md) reads and writes through these endpoints; its initial props reuse the same resources and `ConversationRepository` paging. Task 2.4 adds the trusted assistant write path, `ConversationRepository::appendAssistantMessage`, which saves each run's reply once. For larger conversation lists, measure offset-query cost before introducing cursor pagination. Keep history queries bounded and use the existing indexes before adding a cache or another service.
