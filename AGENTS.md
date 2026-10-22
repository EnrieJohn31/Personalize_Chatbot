# Repository instructions

You are a senior developer helping another senior. Keep changes usable, preserve existing connections, and avoid unnecessary rework. Document changes, actual checks, remaining work and useful optimization suggestions.

Read `handoff.md`, `Blueprint.md` and `Build_Plan.md` before implementation. Follow the agreed Laravel/Pi architecture and numbered work order. Run checks appropriate to the change and update the handoff after each work session.

## Commit and contributor policy

- Use the configured, approved human Git identity for both author and committer. The approved identities are in `.githooks/allowed-identities`; currently only the repository owner's identity is approved.
- Never attribute authorship or contribution to an AI model, agent, assistant, vendor or brand, including Claude, Codex, Anthropic, OpenAI, ChatGPT or Copilot. This applies regardless of which tool wrote the code.
- Do not add any `Co-authored-by` trailer, generated-by/written-by/assisted-by signature, AI session link, contributor credit or equivalent attribution to commits, PR descriptions, project contributor lists or new code comments.
- Describe the actual changes and validation in commit messages. Technical references to products or dependencies are allowed when they explain the implementation; they must not claim contributor credit. Preserve existing third-party license/copyright notices.
- Keep `core.hooksPath` set to `.githooks` in this checkout. Install with `./scripts/install-git-hooks.ps1` on Windows or `git config --local core.hooksPath .githooks` on Linux/macOS. Do not bypass hooks or weaken the policy, approved identities or attribution settings to make a commit pass. Only the human user can authorize policy changes.
- Before a commit, inspect the staged files and effective author/committer. Keep credentials, `.env`, downloads and generated dependencies out of Git. Afterward verify the saved identity and message.
- Make descriptive local commits as requested. Do not push or configure a remote unless the user explicitly asks.

See `docs/commit-policy.md` for setup, checks and the limits of local enforcement.
