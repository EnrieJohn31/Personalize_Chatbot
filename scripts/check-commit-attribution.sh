#!/bin/sh
# Shared by the Git hook and the history audit; no runtime dependencies beyond Git's shell tools.
set -eu

if [ "$#" -ne 3 ] || [ ! -f "$1" ]; then
    echo 'Usage: check-commit-attribution.sh MESSAGE_FILE AUTHOR COMMITTER' >&2
    exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
approved="$script_dir/../.githooks/allowed-identities"

for identity in "$2" "$3"; do
    # git var includes a timestamp and timezone; git show identities do not.
    identity=$(printf '%s\n' "$identity" | sed -E 's/[[:space:]][0-9]+[[:space:]][+-][0-9]{4}$//')
    if ! grep -Fqx -- "$identity" "$approved"; then
        echo 'Commit rejected: author and committer must be approved human identities. See docs/commit-policy.md.' >&2
        exit 1
    fi
done

if grep -Eiq '^[[:space:]]*co[-[:space:]]*author(ed)?[-[:space:]]*by[[:space:]]*:' "$1"; then
    echo 'Commit rejected: co-author trailers are not permitted.' >&2
    exit 1
fi

tools='claude|codex|anthropic|openai|chatgpt|copilot|gemini|cursor|windsurf|deepseek|qwen|gpt[-0-9]|(^|[^[:alnum:]])(ai|llm)([^[:alnum:]]|$)'
credits='(generated|written|authored|created|implemented|developed|coded|assisted|powered|produced)[[:space:]-]+(by|with|using)|^[[:space:]]*(author|contributor|assistant|agent|tool)[[:space:]]*:'
if grep -Ei "$credits" "$1" | grep -Eiq "$tools" ||
    grep -Eiq '^[^[:alnum:]]*(ai|llm)[ -](generated|assisted|authored|written)|claude\.ai/(code|share)|chatgpt\.com/codex/tasks/' "$1"; then
    echo 'Commit rejected: AI attribution signatures and session links are not permitted.' >&2
    exit 1
fi
