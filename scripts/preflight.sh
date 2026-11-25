#!/usr/bin/env bash
# Pre-push gate for Bundleen. Run from the repo root on your issue branch:
#   bash scripts/preflight.sh
# Exits non-zero if anything would break. Safe: touches no database, no network
# except `git fetch` and the Google Fonts fetch that `next build` already does.
set -uo pipefail

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
FAIL=0

BRANCH=$(git rev-parse --abbrev-ref HEAD)
step "Branch: $BRANCH"
if [ "$BRANCH" = "main" ]; then red "You are on main. Create an issue branch first."; exit 1; fi

step "1. Up to date with origin/main"
git fetch -q origin main
BEHIND=$(git rev-list --count HEAD..origin/main)
if [ "$BEHIND" -gt 0 ]; then
  red "Branch is $BEHIND commit(s) behind origin/main. Run: git rebase origin/main"; FAIL=1
else green "OK — based on current main"; fi

step "2. No secrets or env files staged in the diff"
CHANGED=$(git diff --name-only origin/main...HEAD)
if echo "$CHANGED" | grep -E '(^|/)\.env|^\.vercel/|^\.clerk/|settings\.local\.json' ; then
  red "Secret-looking files are in your diff. Remove them."; FAIL=1
elif git diff origin/main...HEAD -- . ':(exclude)scripts/preflight.sh' | grep -E '^\+.*(sk_live_|sk_test_|whsec_|-----BEGIN [A-Z ]*PRIVATE KEY)' ; then
  red "A key-looking string was added. Remove it."; FAIL=1
else green "OK"; fi

step "3. Migration check"
NEW_MIG=$(echo "$CHANGED" | grep '^prisma/migrations/' || true)
EDITED_MIG=$(git diff --name-only --diff-filter=MD origin/main...HEAD -- prisma/migrations || true)
if [ -n "$EDITED_MIG" ]; then red "Existing migrations were edited/deleted (never allowed):"; echo "$EDITED_MIG"; FAIL=1; fi
if [ -n "$NEW_MIG" ]; then
  printf '\033[33m%s\033[0m\n' "New migration(s) — merging will run them on PRODUCTION. Flag this in the PR and get owner approval:"
  echo "$NEW_MIG"
  if git diff origin/main...HEAD -- prisma/migrations | grep -iE '^\+.*(DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM|ALTER COLUMN .* TYPE)'; then
    red "Destructive SQL found in a new migration."; FAIL=1
  fi
else green "OK — no schema changes"; fi

step "4. Overlap with other open PRs"
if command -v gh >/dev/null 2>&1; then
  SELF=$(gh pr view --json number -q .number 2>/dev/null || true)
  for n in $(gh pr list --state open --json number -q '.[].number' 2>/dev/null); do
    [ "$n" = "$SELF" ] && continue
    OTHER=$(gh pr diff "$n" --name-only 2>/dev/null || true)
    BOTH=$(comm -12 <(echo "$CHANGED" | sort) <(echo "$OTHER" | sort) | grep -v '^$' || true)
    [ -n "$BOTH" ] && { printf '\033[33mPR #%s also changes:\033[0m\n%s\n' "$n" "$BOTH"; }
  done
  echo "(Overlap is a warning: mention it in your PR so merges are ordered safely.)"
else echo "gh not installed — skipped"; fi

step "5. Type check"
if npm run -s typecheck; then green "OK"; else red "Type errors"; FAIL=1; fi

step "6. Unit tests vs known baseline"
npx vitest run --reporter=json --outputFile=/tmp/bundleen-tests.json >/dev/null 2>&1
node -e '
const r=require("/tmp/bundleen-tests.json");
const baseline=/neighborhood-enrollment-reconciliation\.test\.ts$/;
const bad=[];
for (const f of r.testResults) for (const t of f.assertionResults)
  if (t.status==="failed" && !baseline.test(f.name)) bad.push(f.name.split("/tests/")[1]+" › "+t.fullName);
const known=r.testResults.filter(f=>baseline.test(f.name)).flatMap(f=>f.assertionResults).filter(t=>t.status==="failed").length;
console.log(`passed ${r.numPassedTests} / ${r.numTotalTests}; known baseline failures: ${known}`);
if (bad.length){console.log("NEW failures:\n  "+bad.join("\n  "));process.exit(1)}
if (known>4){console.log("Baseline file got worse ("+known+" > 4)");process.exit(1)}
' && green "OK — no new failures" || { red "New test failures"; FAIL=1; }

step "7. Production compile (no migrations)"
if npx next build >/tmp/bundleen-build.log 2>&1; then green "OK"; else red "Build failed — see /tmp/bundleen-build.log"; tail -30 /tmp/bundleen-build.log; FAIL=1; fi

echo
if [ "$FAIL" -eq 0 ]; then green "PREFLIGHT PASSED — safe to push this branch and open a PR."; else red "PREFLIGHT FAILED — fix the items above before pushing."; fi
exit $FAIL
