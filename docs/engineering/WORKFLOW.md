# Engineering workflow

## Manager lifecycle

REQUEST → UNDERSTAND REQUIREMENTS → ACCEPTANCE CRITERIA → PLAN → DELEGATE →
IMPLEMENT → VERIFY → DIAGNOSE FAILURES → FIX → VERIFY AGAIN → CODE REVIEW →
FINAL VERIFICATION → COMPLETE.

1. Inspect the relevant architecture and current changes. Define observable acceptance
   criteria, exclusions, risks and checks before implementation. Resolve ambiguity
   from project context; ask the user only when a material product decision cannot
   safely be inferred.
2. Create a temporary task record using `TASK_TEMPLATE.md`. Put it in the session's
   scratch directory (use `mktemp -d` under the runtime's temporary directory) and retain its
   path in the chat handoff. Keep it updated at stage transitions. It is not durable
   policy; preserve a sanitized handoff in the chat if the scratch file is unavailable.
   In cloud tasks, resume the existing task's saved state where possible. Before
   ending, save essential acceptance criteria, head-specific evidence, blockers and
   next action in the task handoff and, once a PR exists, its description. A fresh
   cloud task must recover remote branch/PR state; a local scratch file or prior Mac
   chat is never a required dependency. See `CLOUD.md` for cross-task recovery.
3. Delegate each bounded task with requirements, acceptance criteria, owned files,
   prohibited changes, dependencies, expected checks, and evidence/report format.
   Agree on API/data contracts before parallel frontend/backend implementation.
   Only the manager reallocates overlapping ownership. Specialists do not revert
   other agents' or the user's changes.
4. Implementation engineers report changed files, rationale, checks and known risks.
   Their checks are useful but do not replace independent verification.
5. Once writes stabilize, the test engineer independently derives expected behavior
   from requirements and runs relevant checks. A separate UI reviewer inspects the
   running application when UI is affected. Test and UI reviews can run in parallel
   if they do not share mutable fixtures, browser state, ports or output directories.
6. Diagnose each failure with the classification below and assign a targeted fix.
   Include reproduction, expected/actual behavior, evidence, current hypothesis and
   the invariant that must remain intact. Never send only “try again.”
7. Reproduce the original failure after each fix, rerun affected regressions, then
   have an independent code reviewer inspect the complete final diff, including new
   untracked files. Corrections found in review return through the same loop.
8. Check the completion gate against the final file state. Later edits invalidate
   relevant prior evidence. Reverify affected behavior and obtain review of new edits;
   do not rerun unrelated checks without a reason. Report remaining limitations.

## Failure classification and retry control

| Class | Diagnosis and next action |
| --- | --- |
| A — Implementation | Code violates the agreed behavior. Return evidence to the implementation/UI engineer; add appropriate regression coverage. Do not rewrite policy for one coding mistake. |
| B — Test | Independently establish why an assertion, fixture or timing assumption is wrong/flaky. Change tests only with evidence and manager agreement; preserve the intended contract. |
| C — Requirement | Resolve contradictory/ambiguous expectations from current context; surface material unresolved product choices to the user. Do not lower criteria because implementation is hard. |
| D — Process | Repeated omission, clearly insufficient guidance, or a durable project constraint warrants a small instruction improvement and a rerun of the affected workflow. |

Environment failures (missing dependencies, credentials, browser access or safe test
services) are recorded separately as blocked verification, with the needed resource;
they are never silently classified as passing product behavior.

Track attempts by underlying cause, including hypothesis, change and fresh evidence.
After **three targeted fixes** without resolution, stop editing and write explicit
root-cause analysis: reproduction validity, alternatives, assumptions, earliest faulty
boundary and whether architecture must change. Resume only with a materially new,
evidence-backed approach; otherwise report the blocker. Do not cycle the same prompt.

## Specialist failure report

```text
Issue:
Expected:
Actual:
Evidence: command + exit/result, file:line, reproduction, logs or screenshot path
Likely cause: hypothesis, with uncertainty stated
Severity: CRITICAL / MAJOR / MINOR (SUGGESTION for nonblocking review advice)
Recommended next owner:
```

CRITICAL: security/data-loss or similarly severe failure. MAJOR: broken required
behavior or material regression. MINOR: limited-impact defect. SUGGESTION: optional
improvement. Reviewers report findings first; no findings must still state scope and
checks. The manager records disposition of minor findings and suggestions.

## Completion gate

- Every acceptance criterion has evidence for the final state.
- Implementation and relevant tests/regressions pass; required unavailable checks
  are explicitly blocked, never waived by pretending another check is equivalent.
- Applicable UI review covers desktop/mobile, states, keyboard and accessibility,
  with runtime evidence. Source inspection alone is not a visual pass.
- An independent reviewer examined the final diff; no unresolved CRITICAL or MAJOR
  findings remain. Known limitations and minor findings are disclosed.
- Final verification confirms fixes did not invalidate earlier results; no known
  blocker is hidden. The manager makes the completion decision.

For configuration/documentation-only changes, verify syntax, supported settings,
paths, factual commands, role handoffs and consistency; application runtime tests or
UI review may be marked not applicable with a reason. This does not waive checks for
application changes. Small low-risk work can use fewer agents with the scope stated.

## Process improvement and organizational memory

After significant failures or repeated retries, the manager asks why implementation
and the first reviewer missed the defect, whether criteria covered it, whether a
regression test would catch it sooner, and whether specialist instructions were
insufficient. Promote only durable lessons, not one-off task details.

Update `KNOWLEDGE.md` for architecture/commands/fragile areas, the relevant specialist
TOML for role-specific process gaps, and this workflow or `AGENTS.md` only for shared
rules. Record in `PROCESS_LOG.md`: evidence and failure pattern, smallest rule change,
why it prevents recurrence, preserved safeguards, affected workflow rerun and outcome.
If that rerun is blocked, record the improvement as unvalidated, not successful.
Never weaken tests, lower criteria, remove security checks, hide failures, redefine
product requirements or rewrite instructions continuously without evidence.

## Configuration and session behavior

`AGENTS.md` makes the primary agent the manager. `.codex/config.toml` sets the
specialist concurrency budget; standalone `.codex/agents/*.toml` define specialists.
They inherit the user's model and permissions. Reviewer no-edit rules are behavioral
instructions, not a separate security sandbox. Native role discovery depends on the
host; existing sessions may need a new session to load added project configuration.
If named roles are not exposed, the manager reads the TOML and supplies its instructions
explicitly to available subagents. Instructions and knowledge persist in the
repository, while agents are created as needed. The daily issue cycle uses the saved
app automation described in `SCHEDULE.md`, with GitHub-specific rules in
`GITHUB_ISSUES.md`. Use `ISSUE_STATE.md` for resumable cross-cycle operational state;
temporary task records still hold detailed working evidence.

Format checked against official documentation on 2026-10-25:
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents) and
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Example: homeowner request cancellation

For “Let homeowners cancel their open service requests,” the manager first confirms
permitted states and bid implications, then defines ownership, authorization, visible
states and error criteria. The implementation engineer owns server/route/validation
changes; the UI engineer owns controls and feedback against the agreed API contract.
The test engineer verifies owner success, other-user denial, invalid IDs, repeated
cancellation and state/race cases. The UI reviewer independently checks mobile and
desktop confirmation, pending/error behavior, keyboard and focus. If the control
stays disabled after an API error, the manager returns the exact repro and state
evidence to the UI engineer. The tester and UI reviewer recheck the fix. The code
reviewer checks authorization, transitions and concurrency in the final diff. Only
after the gate passes does the manager report completion. Any durable process lesson
is recorded with evidence; an isolated state bug does not trigger a policy rewrite.
