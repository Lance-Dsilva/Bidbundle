# Daily issue schedule

- Automation: `daily-github-issue-engineering` (Daily GitHub issue engineering)
- Kind: local app heartbeat returning to its engineering-manager chat
- Saved status: ACTIVE, confirmed by the automation service on 2026-10-25
- Daily start: 19:00 local time; verified host timezone is **America/Chicago**
- Issue retrieval: 19:05 America/Chicago after preparation/continuity checks
- Repository: https://github.com/Lance-Dsilva/Bidbundle
- Repository working directory: resolve from the checkout with
  `git rev-parse --show-toplevel`; no fixed local path is required by repository policy.

**Cloud migration pending.** The already-saved app heartbeat still targets its local
chat and Mac checkout. This repository preparation does not migrate its destination.
After publishing the cloud environment, configure a supported cloud-targeted daily
task for 19:00 America/Chicago, check its actual destination and first run, then
retire the local heartbeat to prevent competing managers. Do not treat publishing
an environment as activating a cloud scheduler. See `CLOUD.md` for the UI steps.

The app's immediate heartbeat API saves a local-wall-time daily schedule, with no
separate timezone field. The host `/etc/localtime` resolves to
`/var/db/timezone/zoneinfo/America/Chicago` (verified during setup), so the saved
19:00 schedule follows Chicago daylight-saving changes rather than a fixed UTC
offset. This is dependent on the host remaining in America/Chicago; it is not a
separately pinned timezone setting. If the host timezone changes, notify the user
and repair the schedule through the app tool before claiming Chicago alignment.

The 19:00 wakeup prepares the manager session; use short interruptible waits until
19:05 before retrieving issues. A late wakeup proceeds immediately. These are one
cycle, not two independent schedules. Local execution needs the computer awake,
the app running, GitHub authentication/network access, and the workspace available.
Do not archive/remove the current local worktree without first migrating the automation
prompt and current issue state. Local scheduling is saved, but no future run is claimed
to have executed during setup.

Read `GITHUB_ISSUES.md` for selection/continuation policy. Resume unfinished work
first, and never generate replacement work by scanning the repository. Keep
`ISSUE_STATE.md` and the chat handoff current. Notify on meaningful changes, failures,
completion or required user decisions; remain quiet for unchanged waiting states.

Manage scheduling with the app automation tool, preserving its prompt, destination
and other fields when updating. Do not hand-edit the app's automation storage or
create a duplicate. The saved app automation is authoritative for active/paused
status; this document records the confirmed setup state.

Reference: [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations).
