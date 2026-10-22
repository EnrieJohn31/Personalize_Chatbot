# Initial provider choice

Recorded: 22 October 2026 (Asia/Shanghai). Build Plan task 0.3.

Status: **unverified; not enabled for live use**. No credentials were requested, read, copied or created during prerequisite downloads.

| Field | Initial decision |
| --- | --- |
| Intended first path | Pi's OpenAI provider with its supported Sign in with ChatGPT flow, following the blueprint's subscription requirement |
| Provider ID | `openai` |
| Pi packages | `@earendil-works/pi-ai@1.4.0`, `@earendil-works/pi-agent-core@1.4.0` |
| Intended runtime | Node `24.22.1`, inside the private agent container |
| Connection owner | The initial application operator, using one personal, user-owned connection |
| Application owner record | Create and associate the operator's Laravel user ID during application setup; no user exists yet |
| Model ID | Unselected until the eligible model catalog can be verified during task 3.1 |
| Deployment/account eligibility | Unverified; supported application registration and account access must be established in task 3.1 |
| Credential persistence | Planned per-connection, server-side encrypted persistent storage using the release's supported credential-store interface; not implemented |
| Login / refresh / re-authentication | Not tested |
| Streaming / tool calling / Stop / budgets | Not tested in this application |
| Last live test | None |

This is an initial selection inferred from the agreed blueprint, not evidence of an eligible account or working application registration. Pi 1.4.0's [provider documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md) describes the older Codex provider as legacy. Review the selected release's supported setup when implementing task 3.1. Do not copy a host application's credentials, assume subscription eligibility, or silently fall back to paid API-key usage.

Phases 1–2 can proceed using simulated responses. Task 3.1 must record the actual model, authorized owner, deployment eligibility and live test results before enabling this path.
