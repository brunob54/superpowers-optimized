# Fork Improvements (brunob54/superpowers-optimized)

This repository is the third link in a lineage: the original [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent, its optimized fork [REPOZY/superpowers-optimized](https://github.com/REPOZY/superpowers-optimized), and this fork, which builds on the REPOZY v6.6.1 baseline. It adds three feature releases — v6.7.0, v6.8.0, and v6.9.0 — described below. **Status: these additions are under testing and evaluation**; behavior and interfaces may still change based on real-world use.

Contents:

1. [SDD Batched Autonomous Mode (v6.7.0)](#1-sdd-batched-autonomous-mode-v670)
2. [SDD Token-Optimized Review Flow (v6.8.0)](#2-sdd-token-optimized-review-flow-v680)
3. [multi-review — N-Round Independent Document Review (v6.9.0)](#3-multi-review--n-round-independent-document-review-v690)

---

## 1. SDD Batched Autonomous Mode (v6.7.0)

### Summary

- Executes an implementation plan in **batches of up to N tasks per session**, each task handled by a fresh subagent with full review gates.
- A batch ends when **context pressure reaches 60%** (measured by a new `--pressure` CLI on the skill-activator hook; if measurement fails, the batch caps at 3 tasks), when the user's task count is reached, when the plan completes, or when a blocker occurs.
- At batch end, a **handoff is written into `state.md`** (hard cap 100 lines): current goal, next task, decisions made autonomously, discovered constraints, open issues, and exact resume instructions.
- After `/clear`, **"resume the plan"** reconciles position from `plan.md` checkboxes and git history (authoritative) rather than the narrative state file, and refuses to execute past an unanswered blocking question.

### Motivation

Long implementation plans cannot finish inside one context window. Without a batch boundary, sessions drift into auto-compaction mid-task — losing decisions, re-dispatching completed work, and guessing at plan ambiguities with nobody watching. Batched Autonomous Mode makes the boundary explicit and crash-safe: context pressure is measured instead of guessed, position lives in durable artifacts (checkboxes, commits, ledger), and blockers become journaled questions instead of silent best-guesses.

### How it works

- Inside a batch, execution is fully autonomous (the user is never asked); tasks run sequentially so the boundary can be evaluated after every task.
- Pressure check: `node hooks/skill-activator.js --pressure "$(pwd)"` returns JSON with `overThreshold: true` at ≥60%.
- Review gates are not relaxed: every task still gets the full task review, and pre-implementation security review where flagged.
- On resume, a crash between commit and checkbox update is detected from `git log` and the checkbox is reconciled before dispatching anything.

### How to use

Say any of (with a plan file present):

- `implement the next 3 tasks from docs/plans/<plan>.md`
- `execute the plan in batches`
- after `/clear`: `resume the plan`

To inspect pressure yourself: `node hooks/skill-activator.js --pressure "$(pwd)"`.

### Where it lives

`skills/subagent-driven-development/SKILL.md` (Batched Autonomous Mode section), `hooks/skill-activator.js` (`--pressure`), `hooks/skill-rules.json` (batch/resume triggers), `tests/claude-code/test-batched-autonomous-mode.sh`.

### References

- Design spec: [specs/2026-07-06-sdd-batched-autonomous-mode-design.md](specs/2026-07-06-sdd-batched-autonomous-mode-design.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.7.0

---

## 2. SDD Token-Optimized Review Flow (v6.8.0)

### Summary

- Ports the upstream obra/superpowers v6.0.0 review rework into this fork's subagent-driven-development skill, with fork extensions.
- **One task reviewer with two verdicts** (spec compliance + code quality) replaces the previous two separate reviewer roles per task.
- **File-based handoffs**: three new scripts — `sdd-workspace`, `task-brief`, `review-package` — write briefs, reports, and diff packages under `.superpowers/sdd/`, so dispatch prompts carry file paths instead of pasted text.
- Every subagent dispatch must name its **`model:` explicitly** (haiku/sonnet/opus by task type) — silent inheritance of the session's most expensive model is banned.
- A **`progress.md` ledger** records completed tasks and carried findings, making execution compaction-safe.
- Upstream-measured impact (obra v6.0.0, adopted here): roughly 2x faster, ~50–60% fewer tokens per executed plan.

### Motivation

Token cost in subagent-driven execution was dominated by three habits: pasting task text, diffs, and reports into prompts (which then stay resident in the controller's context forever), running two review passes per task over the same diff, and letting every subagent silently inherit the most capable model. Separately, context compaction could make a controller lose its place and re-dispatch entire completed task sequences — the single most expensive failure mode. The port attacks all four: paths instead of pasted text, one merged review gate, mandatory explicit model selection, and a durable ledger.

### How it works

- `scripts/task-brief PLAN_FILE N` extracts one task's full text to a uniquely named file; the implementer reads it as its requirements and writes its report beside it.
- `scripts/review-package BASE HEAD` builds a single diff package (commit list + stat + full diff) for the reviewer; the fork-added `--commits SHA...` mode builds per-task packages in **parallel waves**, where a plain range would mix sibling tasks' interleaved commits.
- Reviewer ⚠️ "cannot verify from diff" items are resolved by the controller, which holds the cross-task context.
- One fix subagent handles all of a review's Critical/Important findings together; Minor findings are carried in the ledger to final-review triage.

### How to use

The flow is automatic whenever subagent-driven-development executes a plan — e.g. `execute the plan with subagents` or via the writing-plans handoff. Artifacts to inspect afterwards, all under `.superpowers/sdd/` (git-ignored scratch):

- `progress.md` — the task ledger (completion lines, carried Minor findings)
- `task-N-brief.md` / `task-N-report.md` — per-task requirements and implementer reports
- `review-*.diff` — the exact packages reviewers saw

### Where it lives

`skills/subagent-driven-development/` (SKILL.md, `task-reviewer-prompt.md`, `implementer-prompt.md`, `scripts/`), `tests/sdd-scripts/run-tests.sh`.

### References

- Design spec: [specs/2026-07-18-sdd-token-optimization-design.md](specs/2026-07-18-sdd-token-optimization-design.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.8.0
- Upstream origin of the flow: obra/superpowers v6.0.0

---

## 3. multi-review — N-Round Independent Document Review (v6.9.0)

### Summary

- Runs up to **N independent review rounds** (default 3, cap 10) on a spec or plan document before its approval gate.
- Each round dispatches **one clean-context reviewer subagent** that has never seen the authoring conversation, the design rationale, or prior rounds' findings — under a **rotating lens**: correctness & completeness → ambiguity & testability → feasibility & architecture risk → adversarial failure modes.
- Between rounds, every Critical/Important finding is **applied to the document or rejected with a written reason** — silent drops are forbidden — and every disposition is recorded in a sidecar audit log `<doc-basename>-review-log.md`.
- The loop **exits early after two consecutive clean rounds**; brainstorming (spec gate) and writing-plans (plan gate) invoke it automatically, once per gate.

### Motivation

A single review — even a careful one — inherits the authoring conversation's blind spots: the reviewer has already accepted the document's framing. Independent clean-context rounds under different lenses keep finding real, disjoint issue classes. Dogfood evidence from building this very feature: its own spec collected **22 findings across 3 rounds** and its implementation plan **18 findings** — none of the rounds came back clean ([spec review log](specs/2026-07-19-multi-review-design-review-log.md), [plan review log](plans/2026-07-19-multi-review-review-log.md)).

### How it works

- Reviewers receive only template placeholders (document path, doc type, lens instructions, and — for plans — the spec path); they are barred from the Skill tool, review logs, sibling spec/plan documents, and the target's git history.
- Convergence is judged from the reviewer's **enumerated findings** (never the count line, never post-triage): a round is clean at zero Critical and zero Important. Rejecting findings at triage never makes a round clean, so the controller cannot game the exit. An unusable report is retried once, then logged `inconclusive` (breaks the clean streak).
- Reviewer reports open with the marker `<!-- multi-review report -->`; `hooks/subagent-guard.js` exempts such messages from skill-leakage blocking, since reports about skill-discussing documents legitimately quote skill names.
- N semantics: integer 0–10 (anything else falls back to 3); N=0 skips the loop but logs a `skipped` entry; the loop runs at most once per gate (recorded in the log, surviving restarts).

### How to use

- **Automatic:** at the brainstorming spec gate and the writing-plans plan gate, the loop runs before the user-approval step and asks for N once if you haven't stated a count.
- **Direct:** `/multi-review docs/specs/<doc>.md 3` — or phrases like `review this spec 3 times` / `run independent review rounds on docs/plans/<plan>.md`.
- **Audit trail:** read `<doc-basename>-review-log.md` next to the document for per-round verdicts and every disposition.

### Where it lives

`skills/multi-review/` (`SKILL.md` controller + `reviewer-prompt.md` dispatch template), gate steps in `skills/brainstorming/SKILL.md` and `skills/writing-plans/SKILL.md`, `hooks/skill-rules.json` routing entry, `hooks/subagent-guard.js` marker exemption, `tests/claude-code/test-multi-review.sh`.

### References

- Design spec: [specs/2026-07-19-multi-review-design.md](specs/2026-07-19-multi-review-design.md)
- Review logs (dogfood evidence): [spec](specs/2026-07-19-multi-review-design-review-log.md), [plan](plans/2026-07-19-multi-review-review-log.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.9.0
