# Issue-work continuation schedule

- Automation: `github-engineering-every-eight-hours` (GitHub engineering every eight hours)
- Kind: local app heartbeat returning to its engineering-manager chat
- Saved status: ACTIVE, updated through the automation service on 2026-10-27
- Cadence: every eight hours; begin continuation/intake immediately
- User timezone: America/Chicago; the old daily 19:00/19:05 intake is superseded
- Repository: https://github.com/Lance-Dsilva/Bidbundle
- Repository working directory: resolve from the checkout with
  `git rev-parse --show-toplevel`; no fixed local path is required by repository policy.

**Cloud migration pending.** The already-saved app heartbeat still targets its local
chat and Mac checkout. This repository preparation does not migrate its destination.
After publishing the cloud environment, configure a supported cloud-targeted recurring
task with the same eight-hour cadence, check its actual destination and first run, then
retire the local heartbeat to prevent competing managers. Do not treat publishing
an environment as activating a cloud scheduler. See `CLOUD.md` for the UI steps.

The saved heartbeat returns to this chat every eight hours and resumes unfinished
work, including work interrupted by usage limits once capacity is available. It
cannot bypass account limits. Record a checkpoint before stopping. If external
infrastructure blocks an issue, record and park it, then continue another eligible
independent issue as the user requested; do not declare parked work resolved.

Local execution needs the computer awake, the app running, network/authentication
and the workspace available. Do not archive/remove the current local worktree
without first migrating the automation prompt and current issue state. No cloud
schedule is claimed active by this document.

Read `GITHUB_ISSUES.md` for selection/continuation policy. Resume actionable unfinished work
first; track parked external blockers and continue independent issues. Never generate
replacement work by scanning the repository. Keep
`ISSUE_STATE.md` and the chat handoff current. Notify on meaningful changes, failures,
completion or required user decisions; remain quiet for unchanged waiting states.

Manage scheduling with the app automation tool, preserving its prompt, destination
and other fields when updating. Do not hand-edit the app's automation storage or
create a duplicate. The saved app automation is authoritative for active/paused
status; this document records the confirmed setup state.

Reference: [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations).
