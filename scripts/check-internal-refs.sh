#!/usr/bin/env bash
# decker's recipes describe production systems, which is the point. Naming the
# private repositories, inventories, service units and hosts behind them is
# not: that detail belongs in the systems it came from.
#
# The patterns themselves are NOT in this repo - listing them here would
# publish exactly what they are meant to keep out. CI passes them in through
# INTERNAL_REF_PATTERNS (an extended-regex alternation, from a repository
# secret). Without it the check is a no-op, so forks and clones are unaffected.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -z "${INTERNAL_REF_PATTERNS:-}" ]; then
  echo "INTERNAL_REF_PATTERNS not set; skipping"
  exit 0
fi

fail=0
hits=$(git ls-files | grep -v '^scripts/check-internal-refs.sh$' |
       xargs grep -nEIi "$INTERNAL_REF_PATTERNS" 2>/dev/null)
if [ -n "$hits" ]; then
  echo "internal references in tracked files:"
  echo "$hits"
  fail=1
fi

base="${GITHUB_BASE_REF:-}"
if [ -n "$base" ] && git rev-parse --verify -q "origin/$base" >/dev/null; then
  msgs=$(git log --format='%H %s%n%b' "origin/$base..HEAD" | grep -nEi "$INTERNAL_REF_PATTERNS")
  if [ -n "$msgs" ]; then
    echo "internal references in commit messages:"
    echo "$msgs"
    fail=1
  fi
fi

[ "$fail" = 0 ] && echo "no internal references found"
exit $fail
