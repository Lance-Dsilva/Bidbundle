# Bundleen

This repository contains the Bundleen responsive Next.js web application.

## Web application

Application source lives in `src/`, with static assets in `public/`.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

For reproducible cloud setup, runtime/service requirements and Codex publishing
steps, read [Codex Cloud setup](docs/engineering/CLOUD.md).

## Engineering team

Codex operates as a manager-led engineering team using [AGENTS.md](AGENTS.md),
specialists in `.codex/agents/`, and the [engineering workflow](docs/engineering/WORKFLOW.md).
See [repository knowledge](docs/engineering/KNOWLEDGE.md) for architecture, verification
commands, and database safety constraints. In particular, `npm run build` applies
database migrations before compiling the application.

The [recurring GitHub issue workflow](docs/engineering/GITHUB_ISSUES.md) continues one
issue at a time using a persistent GitHub Operations Engineer. See the
[schedule](docs/engineering/SCHEDULE.md) and [resume state](docs/engineering/ISSUE_STATE.md).
