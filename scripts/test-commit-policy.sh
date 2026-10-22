#!/bin/sh
# Exercise real commits in an isolated, ignored repository, never the application's history.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$root/.setup"
fixture=$(mktemp -d "$root/.setup/commit-policy-tests.XXXXXX")
mkdir -p "$fixture/.githooks" "$fixture/scripts"
cp "$root/.githooks/commit-msg" "$root/.githooks/allowed-identities" "$fixture/.githooks/"
cp "$root/scripts/check-commit-attribution.sh" "$fixture/scripts/"
chmod +x "$fixture/.githooks/commit-msg"
git -C "$fixture" init -q
git -C "$fixture" config core.hooksPath .githooks
git -C "$fixture" config user.name EnrieJohn31
git -C "$fixture" config user.email enriejohnedem@gmail.com
git -C "$fixture" config commit.gpgsign false

# Explicit test identities avoid inherited environment variables changing the positive cases.
export GIT_AUTHOR_NAME=EnrieJohn31 GIT_AUTHOR_EMAIL=enriejohnedem@gmail.com
export GIT_COMMITTER_NAME=EnrieJohn31 GIT_COMMITTER_EMAIL=enriejohnedem@gmail.com

expect_rejection() {
    label=$1
    reason=$2
    shift 2
    if "$@" > "$fixture/output" 2>&1; then
        echo "FAIL: $label unexpectedly created a commit" >&2
        exit 1
    fi
    if ! grep -Fq "$reason" "$fixture/output"; then
        cat "$fixture/output" >&2
        echo "FAIL: $label failed for a different reason" >&2
        exit 1
    fi
    echo "PASS: $label rejected"
}

git -C "$fixture" commit -q --allow-empty -m 'Configure Claude and OpenAI integrations'
echo 'PASS: human commit with technical product references accepted'
git -C "$fixture" commit -q --allow-empty -m 'Add AI-assisted reply settings'
echo 'PASS: feature description without contributor credit accepted'

expect_rejection 'co-author trailer' 'co-author trailers' \
    git -C "$fixture" commit --allow-empty -m 'Update settings' -m 'Co-Authored-By: Claude <noreply@anthropic.com>'
expect_rejection 'human co-author trailer' 'co-author trailers' \
    git -C "$fixture" commit --allow-empty -m 'Update settings' -m 'co-authored-by: EnrieJohn31 <enriejohnedem@gmail.com>'
expect_rejection 'generated-by signature' 'AI attribution' \
    git -C "$fixture" commit --allow-empty -m 'Update settings' -m 'Generated with Claude Code'
expect_rejection 'AI-assisted signature' 'AI attribution' \
    git -C "$fixture" commit --allow-empty -m 'AI-assisted implementation'
expect_rejection 'session link' 'AI attribution' \
    git -C "$fixture" commit --allow-empty -m 'Update settings' -m 'https://claude.ai/code/session-test'
expect_rejection 'author override' 'approved human identities' \
    git -C "$fixture" commit --allow-empty --author='Claude <noreply@anthropic.com>' -m 'Update settings'
expect_rejection 'committer override' 'approved human identities' \
    env GIT_COMMITTER_NAME=Codex GIT_COMMITTER_EMAIL=agent@example.invalid \
    git -C "$fixture" commit --allow-empty -m 'Update settings'
expect_rejection 'unknown author' 'approved human identities' \
    git -C "$fixture" commit --allow-empty --author='Unapproved Identity <new@example.invalid>' -m 'Update settings'

count=$(git -C "$fixture" rev-list --count HEAD)
test "$count" = 2
echo 'PASS: rejected commits did not change fixture history (10 cases total)'
