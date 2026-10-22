#!/bin/sh
set -eu

root=$(git rev-parse --show-toplevel)
message=$(mktemp)
trap 'rm -f "$message"' EXIT HUP INT TERM

git rev-list HEAD | while IFS= read -r revision; do
    git show -s --format=%B "$revision" > "$message"
    author=$(git show -s --format='%an <%ae>' "$revision")
    committer=$(git show -s --format='%cn <%ce>' "$revision")
    if ! sh "$root/scripts/check-commit-attribution.sh" "$message" "$author" "$committer"; then
        echo "Attribution audit failed at commit $revision" >&2
        exit 1
    fi
done
echo 'All commits reachable from HEAD satisfy the contributor policy.'
