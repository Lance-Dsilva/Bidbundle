---
name: fix-issue
description: End-to-end workflow to take one Bidbundle GitHub issue from intake to a reviewed, verified pull request, with the human writing or approving every code change. Use when the user says "work on issue N", "fix #N" or "/fix-issue N".
---

# Fix a Bidbundle issue

Argument: the issue number. The user wants to **write the fix themselves** with your
guidance, so suggest code and explain it; apply edits only when the user says to.

## 1. Intake
- Delegate to the `issue-analyst` agent with the issue number.
- If it reports an open PR already covers the issue, stop and tell the user.
- Show the user the analysis and agree the plan before touching code.

## 2. Branch
```sh
git fetch origin main
git switch -c <prefix>/issue-<n>-<slug> origin/main
```
Ask the user for their prefix once (e.g. their GitHub username) and reuse it.

## 3. Intake comment (ask before posting)
Draft and, once approved, post with `gh issue comment <n> --body-file -`:
```
Picking this up on branch `<branch>` from current main. No existing PR found.

Plan:
- ...
Acceptance:
- [ ] ...
```

## 4. Test first
Write the failing test(s) from the plan. Run just that file with
`npx vitest run tests/<file>` and show it fails for the right reason.

## 5. Implement
Walk the user through each change: file, what to change, why. Prefer the smallest
change that fixes the root cause. Re-run the focused test until it passes.

## 6. Commit
Small conventional commits authored by the user (their own git identity):
`git commit -m "fix: <what changed> (#<n>)"`. Ask before committing.

## 7. Verify and review (independent)
- Delegate to `test-verifier`. If NOT READY, fix and repeat.
- Delegate to `code-reviewer`. Resolve every blocker and should-fix, then re-verify.

## 8. Push and PR
Follow the `open-pr` skill.
