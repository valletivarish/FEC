# H9FECC Fog & Edge Computing CA

## Source of truth

`FEC Project Descript.md` (the assignment brief) is the **only** source of truth for scope and
requirements. Every technical decision must trace to a specific line in it. Never add a service,
library, or pattern because it's available — only because the brief or the assessment criteria
require it. Full detailed plan: `~/.claude/plans/mossy-herding-alpaca.md`.

## What this repo is

Fifteen independent fog/edge IoT projects, each simulating 10 sensor types across 3 virtual fog
nodes that process and dispatch to a scalable AWS backend with a live dashboard. One GitHub repo,
one root README, each project self-contained in its own top-level folder — see README.md for the
index and current build status.

## Process — read before touching any project

- **One project at a time.** A project does not start until the previous one is completely
  developed, tested, and verified against its definition of done (see below). No skipping ahead,
  no parallel work across projects.
- Local dev/testing against a local AWS emulator; real deployment targets actual AWS. Same code
  path both ways — only the endpoint/credentials config differs, never the code.
- Languages: Python, Java, Node.js only — 5 projects each. IaC: AWS CDK in the project's own
  language. CI/CD: GitHub Actions, deploy gated behind manual approval.
- Code complexity matches a strong MSc student — not junior, not senior-architect
  over-engineering. Comments: 1–2 lines max, explain *why* only, never AI references, TODOs,
  refactor notes, or history.
- No code reuse between projects beyond language/framework necessities. No shared folder
  templates, naming, or dashboard visual themes — every project designed from first principles.
- No `git commit` / `git push` without explicit go-ahead. No work outside this project folder.

## Per-project definition of done

1. All 10 sensors generate data with frequency *and* dispatch rate independently configurable.
2. All 3 fog nodes receive, genuinely process (not pass-through), and dispatch to the backend.
3. Backend runs against the local AWS emulator; config-only swap to real AWS (no code changes).
4. Dashboard renders live, responsive data for every sensor type, own distinct visual theme.
5. The project's scalability mechanism is load-tested with a before/after measurement.
6. Playwright covers functional flows **and** visual regression snapshots.
7. GitHub Actions pipeline (lint, unit, integration, build) green; deploy gated on manual approval.
8. Cross-project similarity check: <10% overlap in structure/naming/logic with every prior project.
9. Brief-compliance re-check against every relevant requirement line.
10. README with install/run instructions for that project.

Only once every item above is true does the next project start.

## Local AWS emulator

`floci` (not LocalStack) — LocalStack's `:latest` image now requires a registered account + auth
token even for free-tier services (a 2026 licensing change) that broke zero-friction
reproducibility for a marker. floci needs no signup, exposes services on the same `:4566` port and
health-check contract, and its free tier covers everything these projects need (SQS, Lambda,
DynamoDB, API Gateway, Kinesis, EventBridge, IoT Core all confirmed running for free). Timestream
is not available even on floci — every project uses DynamoDB for time-series data instead (already
the pattern most projects used anyway), keeping local/real-AWS parity intact.

## Status

See README.md's project table for per-project build status. Update it and this file's "Status"
section as work progresses.
