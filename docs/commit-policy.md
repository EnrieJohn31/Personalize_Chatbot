# Commit and contributor policy

Updated: 22 October 2026. The repository owner requires human contributor identities, no co-authors and no AI attribution, regardless of which coding tool produced a change.

## What is configured

| Layer | Configuration |
| --- | --- |
| Shared repository instructions | Tracked `AGENTS.md` defines the rule for coding agents and future sessions |
| Claude instructions | Tracked `CLAUDE.md` imports `AGENTS.md`, including its Git policy |
| Claude attribution settings | `.claude/settings.json` sets `attribution.commit` and `attribution.pr` to empty strings, and `attribution.sessionUrl` to `false` |
| Approved Git identities | `.githooks/allowed-identities` currently contains only `EnrieJohn31 <enriejohnedem@gmail.com>` |
| Local enforcement | `.githooks/commit-msg` rejects an unapproved author or committer, any co-author trailer, and common AI signatures/session links |
| History checks | `scripts/audit-commit-attribution.sh` checks all commits reachable from HEAD using the same policy |
| CI | The `commit-policy` job tests the hook and audits the actual branch history; PR checks use the head commit rather than a generated merge commit |

The rule concerns attribution. Ordinary technical references to a product or dependency in a change description remain permitted. Existing third-party copyright/license notices must be preserved. The hook rejects prohibited messages rather than silently rewriting them.

## Enable in each checkout

The hook is enabled in the current checkout with repository-local `core.hooksPath=.githooks`. Git does not copy local configuration when cloning, so each fresh clone must enable it. The standard PowerShell setup script now does this before application setup.

PowerShell:

```powershell
./scripts/install-git-hooks.ps1
git config --get core.hooksPath
```

Git Bash, Linux or macOS, after checking for existing hooks:

```bash
git config --get core.hooksPath
git config --local core.hooksPath .githooks
```

The PowerShell installer refuses to replace another hooks path or existing non-sample hooks without integration. It changes only the current repository, not global Git configuration. Use an approved human identity for both author and committer. Adding another real contributor requires the repository owner's approval and an explicit update to the identity list; agents must not add themselves or their vendors.

## Verify

From Git Bash, Linux or macOS:

```bash
sh scripts/test-commit-policy.sh
sh scripts/audit-commit-attribution.sh
git log -3 --format='%h | %an <%ae> | %cn <%ce>%n%B'
```

In this Windows setup, Git Bash is available at `C:/Program Files/Git/bin/bash.exe`; PowerShell can invoke it with `& 'C:/Program Files/Git/bin/bash.exe' scripts/test-commit-policy.sh`.

Local verification passed on 22 October 2026: two approved-human commits with technical product/feature references were accepted; eight attempts containing co-author trailers (including a human co-author), AI signatures, a session link, or unapproved author/committer identities were rejected. Rejected attempts left fixture history unchanged. Tests use isolated repositories under ignored `.setup/commit-policy-tests.*` and do not create test commits in application history. Existing application history passed the audit.

## Scope and limits

This is a persistent project policy with a local Git check, not an immutable server-side restriction. A deliberately disabled hook, low-level Git plumbing, some history import/rewrite operations, or a client that does not run Git hooks can bypass local enforcement. The history audit and CI provide an additional check, but remote branch protection has not been configured. The configured `origin` is `https://github.com/EnrieJohn31/Personalize_Chatbot.git`. On 22 October 2026, the user authorized publication and the existing history, including these instructions, settings and CI configuration, was pushed to `main` and the new `development` branch. CI is configured for pushes to both branches and for pull requests; remote results have not yet been verified. Continue development locally on `development`; future pushes require the user's instruction.

Message checks recognize common attribution signatures and links; they cannot classify every possible natural-language credit. The approved identity list provides an exact check for author and committer metadata. Managed/command-line tool settings can override project settings, and instructions alone cannot guarantee every agent's behavior. Do not bypass the policy; resolve a rejected commit by correcting its identity or message. Report conflicts to the user.

The shared settings use the object form supported by earlier Claude Code versions. The newer `attribution: false` shorthand was not used because versions before 2.1.281 reject it. No Claude session was launched to test its live configuration; the settings follow the official reference and the actual Git-hook behavior was tested locally.

## Configuration sources

- [OpenAI: repository instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- [Claude Code: importing project instructions](https://code.claude.com/docs/en/memory#import-additional-files).
- [Claude Code: attribution settings](https://code.claude.com/docs/en/settings-reference#attribution).
- [Git: commit-msg hooks and their behavior](https://git-scm.com/docs/githooks#_commit_msg).
