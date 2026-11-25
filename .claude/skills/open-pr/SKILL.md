---
name: open-pr
description: Push a verified Bidbundle issue branch and open a pull request with the team's Validation format, then post a handoff comment on the issue. Use only after preflight passes, or when the user says "open the PR" / "push it".
---

# Open a PR for a verified branch

1. Re-sync and re-check — main may have moved:
   ```sh
   git fetch origin main && git rebase origin/main
   bash scripts/preflight.sh
   ```
   If preflight fails, stop. Do not push.
2. Push the branch (never `main`, never `--force` unless the user asks after a rebase,
   and then only `--force-with-lease` on their own branch):
   `git push -u origin HEAD`
3. Create the PR as a **draft** so the owner decides when it is ready:
   `gh pr create --draft --base main --title "<type>: <summary> (#<n>)" --body-file pr.md`
4. `pr.md` template — fill every line with real output, never estimates:
   ```
   <2–4 sentences: what was wrong / missing and what this changes.>

   Closes #<n>.

   Based on main <short sha>. Head: <short sha>.

   ## Validation
   - Typecheck: passed
   - Unit tests: <passed>/<total>; new failures: none (4 known baseline failures in neighborhood-enrollment-reconciliation, unchanged)
   - New tests: <files> — fail without the fix, pass with it
   - `next build`: passed
   - Independent review: <APPROVE / findings fixed>
   - Manual check: <what you clicked through on the Preview, desktop + mobile>

   ## Risk
   - Schema change: none | <migration name> — runs on production at merge, needs owner approval
   - Overlaps with: <open PRs touching same files, or none>
   ```
5. Wait for the Vercel Preview check (`gh pr checks`), open the Preview URL and do the
   manual check with the user. Update the PR body.
6. Handoff comment on the issue (ask first):
   `Ready for review in PR #<pr>. <one-line validation summary>. Not merged.`
7. Never run `gh pr merge`. The owner merges.
