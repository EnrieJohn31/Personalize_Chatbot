# Tools — task 3.3

Implemented: 24 October 2026. A live reply can call engine tools. The first is `lookup_reference`, a read-only lookup in invented sample records. It has no connection to any real system.

## How a tool call is controlled

```text
Laravel profile ──capabilities──▶ run request ──▶ engine admission ──▶ ToolExecutor ──▶ tool
 (ASSISTANT_CAPABILITIES)          (snapshot)      (unknown → 422)       (checks each call)
```

- **Permission.** The run request carries the profile's capability snapshot (`config/assistant.php` → `profile.capabilities`, from `ASSISTANT_CAPABILITIES`, default `lookup_reference`). The browser never chooses it.
  - The engine refuses a run that asks for a capability it cannot enforce (`422 unsupported_capability`).
  - The model is offered only the tools the snapshot permits. A call to anything else is `blocked` and never runs.
- **Registry.** Tools are registered statically in `agent-service/src/tools/registry.ts`, never loaded from folders or requests. Each declares:
  - a stable name, label and description;
  - a TypeBox input schema;
  - the capability that permits it;
  - its effect (only `read` exists);
  - a timeout (10 seconds);
  - a result-size cap (4,000 characters).
- **Each call** (`tools/executor.ts`):
  - Pi validates the arguments against the schema. A mismatch is `invalid_arguments`, and the tool does not run.
  - The executor then refuses tools that are not permitted, repeated call IDs, and calls beyond the run's `maxToolCalls` (6).
  - When the call runs, permission and arguments are checked again.
  - The run is bounded by the timeout; a slow tool is abandoned even if it ignores the abort signal.
  - Results over the cap are shortened at a character boundary, with a note to the model. The note counts toward the same size cap.
  - Internal errors are not passed on: the model sees "could not complete".
- **Rounds.** Each model request is a round. Before the run's last round (`maxModelRounds`, 4), or once the tool budget is used up, the tools are withdrawn. Pi tells the model, which then has to answer with what it has; no request goes beyond the last round. A run allowed only one round offers no tools.
- **Outcomes.** Every call the model makes ends with an explicit result for the model and a `tool.finished` event. Its outcome is `ok`, `blocked`, `invalid_arguments`, `failed` or `timeout`.

## Events

| Event | Data | When |
| --- | --- | --- |
| `run.progress` | `{stage: "retrieving"}` | A permitted call starts; `answering` again when text resumes |
| `tool.started` | `{toolCallId, name}` | A permitted call passed its checks and runs |
| `source.added` | `{toolCallId, evidenceId, title, locator, checkedAt}` | Each record a successful lookup returned |
| `tool.finished` | `{toolCallId, name, outcome, message}` | Every call the model made, run or refused |

Events never carry tool arguments or result text. Validation failures use a fixed explanation in browser events; Pi's detailed validation error, which includes the arguments, stays in the model's tool result. Source metadata is kept apart from the text the model reads, as the Blueprint requires. Laravel validates each event (`App\Data\Agent\RunEvent`) and relays it. The chat page shows "Looking up references…" while a lookup runs; it does not list sources yet.

## `lookup_reference`

- **Input.** `{query}`: a reference code such as `SAMPLE-001`, or keywords (1–200 characters).
- **Matching.** A code anywhere in the query wins. Otherwise entries are ranked by how many query words (three letters or more, common words ignored) appear in their title, text or keywords.
- **Result.** Up to three entries, each as `[CODE] Title (evidence ID, checked date)` followed by its text, or "No reference entry matches …".
- **Fixture.** Five invented entries in `agent-service/src/tools/reference-fixture.ts`: two sample sites, two policies and a facility note.

## Adding a tool

1. Add a `ToolDefinition` module under `agent-service/src/tools/` with its schema, capability, effect, timeout and size cap, and add it to `TOOLS` in `registry.ts`.
2. Grant its capability in Laravel (`ASSISTANT_CAPABILITIES`), and bump the profile version in `config/assistant.php` when the default changes.
3. Add engine tests on Pi's faux provider for a permitted call, a refused call and invalid arguments.

A tool with a write effect needs its own authorization and confirmation design first (Blueprint section 9).

## Checks

```powershell
docker compose exec agent npm test                                          # tools.test.mjs, live-runs.test.mjs
docker compose exec --user sail laravel.test php artisan test --filter="RunEvent|ChatRun|RunRequestFactory"
```
