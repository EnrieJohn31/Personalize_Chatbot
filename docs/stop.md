# Stop: task 3.5

Implemented on 25 October 2026 at the user's request before task 3.4. Context/token budgeting remains open.

## Request and execution

1. The browser sends `DELETE /api/chat/runs/{run}` through the authenticated Laravel route. Only the owner may stop the run. The stream stays open while the page shows "Stopping…".
2. Laravel sends the signed private cancellation request. Its `202 cancel_requested` response acknowledges the request; the terminal event confirms the outcome.
3. The run abort controller reaches Pi and active tools. Before credential setup, another model request or tool dispatch, the engine checks whether cancellation was requested. Adapter errors after abort become cancellation instead of an internal-error failure.
4. The tool executor combines the run and tool signals and its timeout. It refuses dispatch after cancellation, stops waiting on active work, and discards late results/rejections. `tool.finished` may report `cancelled`; `run.cancelled` ends the reply. Buffered deltas are not flushed after abort.
5. Laravel saves no assistant answer for a cancelled run and releases the active-run slot when the terminal event is relayed. The partial browser draft is marked "Stopped"; reload shows only saved history and offers another reply. Repeated Stop is idempotent, and late Stop does not replace a completed answer.

The default tool registry remains static. Tests inject a controlled slow lookup through a trusted engine-only option; neither HTTP payloads nor users can supply tool definitions.

## Verification and limits

Six new regression cases failed before the guards were added. The engine suite now also covers Stop inside the complete tool loop, suppression of remaining tool calls/model rounds, and late/repeated Stop. Laravel tests cover the new tool outcome, no final save and release of the user's slot. Actual checks and live measurements are recorded in [validation](validation.md).

- A deliberately slow, non-cooperating test tool settled its wrapper 0.28 ms after Stop; the complete Pi tool loop reached `run.cancelled` in 1.22 ms in the recorded controlled run. These are local observations, not latency guarantees.
- The live Chromium check on the chosen ChatGPT connection and `gpt-6-luna` reached browser cancellation in 5,655 ms; the HTTP acknowledgement took 5,850 ms. One lookup finished before Stop. The browser observed 38 more text chunks while Stop was pending, saved no assistant answer, and offered another reply after reload. This measures the complete local route/relay and transport, not provider-only abort latency.
- The real fixture lookup is a small synchronous in-memory search. A Stop arriving during that synchronous work can only be processed once it yields. No artificial delay was added to the production tool.
- Pi 1.4.0 stops the caller's wait for authentication on abort. A token renewal that has already started continues through persistence under its own 15-second timeout, preserving any rotated refresh token. This intentional exception was confirmed by inspecting the installed authentication code during the 26 October publication review; it does not continue the cancelled chat's model/tool work.
- Cancelling the local provider transport does not prove that the remote provider immediately stops computation or billing. Network/proxy buffering can also deliver already-emitted chunks while cancellation is pending.
- A tool that ignores abort may continue its own work after the wrapper stops waiting; its late result cannot become a source or successful answer. Future tools must pass the signal to their I/O, keep bounded timeouts and define cleanup for their own resources.
- Stage A cancellation is process-local in the engine and uses Laravel's existing cache-backed run record. Durable flags, atomic completion/Stop races, crash recovery and retained events remain Phase 4–5 work. Closing the browser is not Stop.
