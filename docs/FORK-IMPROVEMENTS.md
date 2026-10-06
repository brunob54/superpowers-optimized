# Fork Improvements (brunob54/superpowers-optimized)

This repository is the third link in a lineage: the original [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent, its optimized fork [REPOZY/superpowers-optimized](https://github.com/REPOZY/superpowers-optimized), and this fork, which builds on the REPOZY v6.6.1 baseline. It adds five flagship feature releases — v6.7.0, v6.8.0, v6.9.0, v6.10.0, and v6.14.0 — described below; four smaller releases (v6.11.0–v6.13.0: the `multi-doc-review` rename, the plan-scoped SDD workspace, and the fresh-session plan handoff; v6.15.0: the cap-only batch boundary) are covered in [../RELEASE-NOTES.md](../RELEASE-NOTES.md). **Status: these additions are under testing and evaluation**; behavior and interfaces may still change based on real-world use.

For a detailed, evidence-focused comparison of how review works in all three repositories — including the history of obra's own document review loop (shipped in v5.0.0, removed in v5.0.6 on eval data) — see [REVIEW-PROCESS-COMPARISON.md](REVIEW-PROCESS-COMPARISON.md).

Contents:

1. [SDD Batched Autonomous Mode (v6.7.0)](#1-sdd-batched-autonomous-mode-v670)
2. [SDD Token-Optimized Review Flow (v6.8.0)](#2-sdd-token-optimized-review-flow-v680)
3. [multi-doc-review — N-Round Independent Document Review (v6.9.0)](#3-multi-doc-review--n-round-independent-document-review-v690)
4. [multi-code-review — N-Round Independent Whole-Branch Code Review (v6.10.0)](#4-multi-code-review--n-round-independent-whole-branch-code-review-v6100)
5. [orchestrating-development — Autonomous Spec-to-Merge-Gate Pipeline (v6.14.0)](#5-orchestrating-development--autonomous-spec-to-merge-gate-pipeline-v6140)

---

## 1. SDD Batched Autonomous Mode (v6.7.0)

*Through v6.14.0 the primary batch boundary was a measured 60% check of the context fill. v6.15.0 replaced it with a fixed task cap: batches are expected to start in fresh sessions (the writing-plans handoff and resume flow both route through `/clear`), which made the in-batch measurement redundant — and its hardcoded 200K window overstated the fill five-fold on 1M-context models, ending batches at ~13% real occupancy. The baseline also carried a check at prompt submission: at 60% fill it answered a prompt such as "execute the plan" with a STOP block in place of the skill hints. v6.15.0 gave that check an opt-in status line script as its source of the window size. The check, the status line script, the script's installer and the threshold variable were removed later. Three measured facts decided it: the hook input states neither the context usage nor the window size; the check divided by 200K whenever the script's file was missing, older than 30 minutes or written by another session; and no session in five weeks of kept transcripts (1,885 files) had triggered it.*

### Summary

- Executes an implementation plan in **batches of up to N tasks per session**, each task handled by a fresh subagent with full review gates.
- A batch ends at a **fixed task cap** — the user's explicit task count, otherwise 3 — or earlier when the plan completes or a blocker occurs.
- At batch end, a **handoff is written into `state.md`** (hard cap 100 lines): current goal, next task, decisions made autonomously, discovered constraints, open issues, and exact resume instructions.
- After `/clear`, **"resume the plan"** reconciles position from `plan.md` checkboxes and git history (authoritative) rather than the narrative state file, and refuses to execute past an unanswered blocking question.

### Motivation

Long implementation plans cannot finish inside one context window. Without a batch boundary, sessions drift into auto-compaction mid-task — losing decisions, re-dispatching completed work, and guessing at plan ambiguities with nobody watching. Batched Autonomous Mode makes the boundary explicit and crash-safe: the batch size is bounded up front, position lives in durable artifacts (checkboxes, commits, ledger), and blockers become journaled questions instead of silent best-guesses.

### How it works

- Inside a batch, execution is fully autonomous (the user is never asked); tasks run sequentially so the boundary can be evaluated after every task.
- Review gates are not relaxed: every task still gets the full task review, and pre-implementation security review where flagged.
- On resume, a crash between commit and checkbox update is detected from `git log` and the checkbox is reconciled before dispatching anything.

### How to use

Say any of (with a plan file present):

- `implement the next 3 tasks from docs/superpowers-orchestrator/<date>-<slug>/plans/<slug>.md`
- `execute the plan in batches`
- after `/clear`: `resume the plan`

### Where it lives

`skills/subagent-driven-development/SKILL.md` (Batched Autonomous Mode section), `hooks/skill-rules.json` (batch/resume triggers), `tests/claude-code/test-batched-autonomous-mode.sh`.

### References

- Design spec: [superpowers-orchestrator/2026-07-06-sdd-batched-autonomous-mode/specs/sdd-batched-autonomous-mode-design.md](superpowers-orchestrator/2026-07-06-sdd-batched-autonomous-mode/specs/sdd-batched-autonomous-mode-design.md)
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

- Design spec: [superpowers-orchestrator/2026-07-18-sdd-token-optimization/specs/sdd-token-optimization-design.md](superpowers-orchestrator/2026-07-18-sdd-token-optimization/specs/sdd-token-optimization-design.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.8.0
- Upstream origin of the flow: obra/superpowers v6.0.0

---

## 3. multi-doc-review — N-Round Independent Document Review (v6.9.0)

*Named `multi-review` through v6.10.0; renamed in v6.11.0 to pair with `multi-code-review`. The historical topic folder `docs/superpowers-orchestrator/2026-07-19-multi-review/` keeps the old name.*

### Summary

- Runs up to **N independent review rounds** (default 3, cap 10) on a spec or plan document before its approval gate.
- Each round dispatches **M clean-context reviewer subagents** (M = reviewers per lens, 1–5, default 1, since v7.4.0; identical prompts, run in parallel, reports consolidated before triage), none of which has ever seen the authoring conversation, the design rationale, or prior rounds' findings — under a **rotating lens**: correctness & completeness → ambiguity & testability → feasibility & architecture risk → adversarial failure modes. Since v7.14.0 a plan document also gets an **Execution readiness** pass before the first round and after the last one — not part of the rotation, not counted in N — which reports the conflicts that would stop an executing agent.
- Between rounds, every Critical/Important finding is **applied to the document or rejected with a written reason** — silent drops are forbidden — and every disposition is recorded in a sidecar audit log `<doc-basename>-review-log.md`.
- The loop **exits early after two consecutive clean rounds**; brainstorming (spec gate) and writing-plans (plan gate) invoke it automatically, once per gate.

### Motivation

A single review — even a careful one — inherits the authoring conversation's blind spots: the reviewer has already accepted the document's framing. Independent clean-context rounds under different lenses keep finding real, disjoint issue classes. Dogfood evidence from building this very feature: its own spec collected **22 findings across 3 rounds** and its implementation plan **18 findings** — none of the rounds came back clean ([spec review log](superpowers-orchestrator/2026-07-19-multi-review/specs/multi-review-design-review-log.md), [plan review log](superpowers-orchestrator/2026-07-19-multi-review/plans/multi-review-review-log.md)).

### How it works

- Reviewers receive only template placeholders (document path, doc type, lens instructions, and — for plans — the spec path); they are barred from the Skill tool, review logs, sibling spec/plan documents, and the target's git history.
- Convergence is judged from the reviewer's **enumerated findings** (never the count line, never post-triage): a round is clean only when the consolidated finding set is empty **and** every reviewer returned a usable report (u = M). Rejecting findings at triage never makes a round clean, so the controller cannot game the exit. An unusable report is retried once; if any reviewer is still unusable after the retry, the round is logged PARTIAL as `usable <u>/<m>` (never clean), unless every reviewer is unusable (u = 0), which is logged `inconclusive` (breaks the clean streak).
- Reviewer reports carry the marker `<!-- multi-review report -->` on their first line; the controller uses a report only when one of its first 10 non-blank lines starts with that marker, and reads the report from that line downward.
- N semantics: integer 0–10 (anything else falls back to the session default (`SUPERPOWERS_REVIEW_ROUNDS`, else 3)); N=0 skips the loop but logs a `skipped` entry; the loop runs at most once per gate (recorded in the log, surviving restarts) — except that a recorded `N=0` (skipped) entry does not block a later invocation, and an interrupted entry (not all of its recorded N rounds logged) is resumed rather than blocked.

### How to use

- **Automatic:** at the brainstorming spec gate and the writing-plans plan gate, the loop runs before the user-approval step, and the gate asks you for N (rounds) and M (reviewers per lens) — for whichever of the two you have not already stated.
- **Direct:** `/multi-doc-review docs/superpowers-orchestrator/<date>-<slug>/specs/<slug>-design.md 3 M=2` — or phrases like `review this spec 3 times` / `run independent review rounds on docs/superpowers-orchestrator/<date>-<slug>/plans/<slug>.md` / `review this spec 3 times with 2 reviewers per lens`. A direct invocation asks for N only; M keeps its own resolution order.
- **Audit trail:** read `<doc-basename>-review-log.md` next to the document for per-round verdicts and every disposition.

### Where it lives

`skills/multi-doc-review/` (`SKILL.md` controller + `reviewer-prompt.md` dispatch template), gate steps in `skills/brainstorming/SKILL.md` and `skills/writing-plans/SKILL.md`, `hooks/skill-rules.json` routing entry, `hooks/session-start` (the `<superpowers-defaults>` session block, v7.13.0), `tests/claude-code/test-multi-doc-review.sh`, `tests/codex/test-session-start-defaults-block.sh`.

### References

- Design spec: [superpowers-orchestrator/2026-07-19-multi-review/specs/multi-review-design.md](superpowers-orchestrator/2026-07-19-multi-review/specs/multi-review-design.md)
- Review logs (dogfood evidence): [spec](superpowers-orchestrator/2026-07-19-multi-review/specs/multi-review-design-review-log.md), [plan](superpowers-orchestrator/2026-07-19-multi-review/plans/multi-review-review-log.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.9.0

---

## 4. multi-code-review — N-Round Independent Whole-Branch Code Review (v6.10.0)

### Summary

- The same loop as multi-doc-review, aimed at a **branch diff** (`BASE..HEAD`) instead of a document: up to **N independent review rounds** (default 3, cap 10).
- Each round dispatches **M clean-context reviewer subagents** (M = reviewers per lens, 1–5, default 1, since v7.4.0; identical prompts, run in parallel, reports consolidated before triage) under a **rotating lens**: correctness & spec alignment → adversarial red-team → security → test & coverage quality. Every lens carries a **prose adaptation** — for files that are instructions to an agent (skills, prompts, configs) rather than executable code, runtime-input attacks are vacuous, so the reviewer attacks *agent misexecution* instead.
- Between rounds, **one fix subagent** handles that round's Critical/Important findings and the next round reviews a **freshly built package** of the fixed code.
- **No fix ships unreviewed:** an exit that would leave the last round's fix unexamined triggers a same-lens verification re-review (capped at 3 cycles).
- Sidecar audit log at `.superpowers/reviews/<branch-slug>-review-log.md` — or, in a pipeline run, `docs/superpowers-orchestrator/<date>-<slug>/implementation/<slug>-review-log.md`, committed — so a direct review is never part of the branch under review. Early exit after **two consecutive clean rounds**.

### Motivation

The v6.9.0 dogfood showed independent lenses finding *disjoint* issue classes on a document. Code has the same property, and subagent-driven-development's final whole-branch review was a single pass — one reviewer, one lens, one chance. This release reuses the v6.9.0 architecture so the two loops stay teachable as one pattern, and adds what code needs that documents do not: fixes applied between rounds, repackaged diffs, and a guarantee that no fix reaches the gate unreviewed.

Dogfood evidence from building it: the design spec collected **33 findings across 4 rounds**, its implementation plan ran **10 rounds**, and the branch itself went through this very loop ([spec review log](superpowers-orchestrator/2026-07-27-multi-code-review/specs/multi-code-review-design-review-log.md), [plan review log](superpowers-orchestrator/2026-07-27-multi-code-review/plans/multi-code-review-review-log.md)).

### How it works

- **Reviewer model:** inherits the session model with a **sonnet floor** — a haiku-tier or unrecognized session model dispatches reviewers on `sonnet`. This replaces subagent-driven-development's previous always-opus final-review rule. Fix subagents follow SDD's existing Model Selection table.
- **A user-supplied BASE is never used raw:** it is charset-rejected (`^[A-Za-z0-9._/~^{}-]+$`) before anything touches a shell, resolved with `git rev-parse --verify`, and ancestry-checked against HEAD — a non-ancestor BASE would render untouched commits as deletions and the reviewer would report them as defects.
- Convergence is judged from the reviewer's **enumerated findings**, never the count line and never post-triage — a round is clean only when the finding set is empty **and** every reviewer returned a usable report (u = M); rejecting findings at triage cannot make a round clean.
- **Once per gate** is keyed on the completion marker's *post-fix* HEAD plus the recorded branch name (an invocation-start HEAD would be defeated by the loop's own fix commits). The tracked-log condition — never honouring a log that `git ls-files` reports as tracked in the branch under review — applies in **direct mode** only; in **pipeline mode** the log is tracked by design, and the completion marker records the **effective HEAD** instead.
- Reviewer reports reuse the marker `<!-- multi-review report -->` of multi-doc-review, and the controller reads them in the same way.

### How to use

- **Automatic:** at subagent-driven-development's final whole-branch review gate, replacing the former single-pass review; in interactive SDD the gate asks you for N and M first, in batched autonomous mode it asks nothing and uses that mode's own rule.
- **Direct:** `/multi-code-review [BASE] [N|N=<n>] [M=<m>]` — or phrases like `review the branch 3 times` / `several independent code reviews of this branch` / `review the branch 3 times with 2 reviewers per lens`. Single-argument form: an integer 0–10 is N, anything else is a git ref.
- **Audit trail:** `.superpowers/reviews/<branch-slug>-review-log.md` — or, in a pipeline run, `docs/superpowers-orchestrator/<date>-<slug>/implementation/<slug>-review-log.md`, committed — for per-round verdicts, dispositions, and fix commit SHAs.
- **Claude Code only** — the loop requires the Agent tool; on Codex and Cursor the SDD gate keeps its single-pass final review.

### Where it lives

`skills/multi-code-review/` (`SKILL.md` controller + `reviewer-prompt.md` dispatch template), the final-gate step in `skills/subagent-driven-development/SKILL.md`, `hooks/skill-rules.json` routing entry, `hooks/session-start` (the `<superpowers-defaults>` session block, v7.13.0), `tests/claude-code/test-multi-code-review.sh`, `tests/codex/test-session-start-defaults-block.sh`.

### References

- Design spec: [superpowers-orchestrator/2026-07-27-multi-code-review/specs/multi-code-review-design.md](superpowers-orchestrator/2026-07-27-multi-code-review/specs/multi-code-review-design.md)
- Implementation plan: [superpowers-orchestrator/2026-07-27-multi-code-review/plans/multi-code-review.md](superpowers-orchestrator/2026-07-27-multi-code-review/plans/multi-code-review.md)
- Review logs (dogfood evidence): [spec](superpowers-orchestrator/2026-07-27-multi-code-review/specs/multi-code-review-design-review-log.md), [plan](superpowers-orchestrator/2026-07-27-multi-code-review/plans/multi-code-review-review-log.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.10.0

---

## 5. orchestrating-development — Autonomous Spec-to-Merge-Gate Pipeline (v6.14.0)

### Summary

- From an **approved design spec**, runs the whole development lifecycle autonomously: plan writing → N independent plan-review rounds → batched implementation → N independent whole-branch code-review rounds — **stopping only on major errors and ending before merge/PR**. The merge decision stays human.
- One interactive **Phase 0** collects everything up front — plan/code review counts, batch task cap, branch point, and a permissions confirmation for the unattended run — then the user is never asked mid-flight; blockers become journaled `BLOCKED` stops with resume instructions, never silent guesses.
- Four fresh-context **controller subagent templates** (plan-writer, doc-review-loop, batch-controller, code-review-loop) each drive one phase by invoking the existing skills (writing-plans, multi-doc-review, subagent-driven-development, multi-code-review); the orchestrator itself only fills template placeholders and reads compact structured returns (`PLAN_DONE` / `REVIEW_DONE` / `BATCH_DONE` / `BLOCKED` / …).
- A **committed orchestration log** `docs/superpowers-orchestrator/<date>-<slug>/<slug>-orchestration-log.md` records every phase boundary, and **resume / abandon** procedures reconstruct or tear down a run from durable artifacts alone (log, plan checkboxes, git history) — a fresh session can pick up a crashed run.

### Motivation

The fork's stages were each automated individually — batched SDD execution (v6.7.0), plan review loops (v6.9.0), branch review loops (v6.10.0) — but a human still had to chain them, and chaining them inside the authoring session pollutes every stage with the previous one's context. Orchestration runs each stage in a fresh controller subagent with only its template placeholders, and makes the whole chain crash-safe: position lives in the committed orchestration log and durable artifacts, so an interrupted pipeline resumes instead of restarting.

### How it works

- Controllers return compact structured final messages; round-by-round detail stays in the sub-skills' own logs and files — it never enters the orchestrator's context. A malformed return gets one identical retry, then the run stops.
- Controllers dispatch their own nested workers (implementers, reviewers, fix subagents). The orchestrator reads a controller return only from a line equal to the `<!-- orchestration report -->` marker among the first 10 non-blank lines of the return, so a controller that writes a sentence above its marker still returns cleanly.
- A **Major-Error Stop Policy** enumerates the stop conditions (unresolved review findings, malformed returns after retry, failed phase-boundary commits, missing artifacts on resume, zero-checkbox plans); each writes a `STOPPED` entry with a one-line reason and the exact resume command.
- The batch controller carries **mid-task crash recovery**: on retry it derives the review base from the last ledger line, falling back to the last `chore(plan): <slug> task <n> complete` commit and then the merge-base with the default branch — never its own starting HEAD — so a crashed attempt's commits can never bypass the task-review gate. A `[RESUME_ANSWER]` placeholder carries the user's answer when a `BLOCKED` run is resumed.
- Dogfood evidence: the feature's own spec collected **35 findings across 4 review rounds**, its implementation plan **22 findings (all applied, none rejected)**, and the branch went through the v6.10.0 whole-branch loop before merging ([spec review log](superpowers-orchestrator/2026-08-04-orchestrating-development/specs/orchestrating-development-design-review-log.md), [plan review log](superpowers-orchestrator/2026-08-04-orchestrating-development/plans/orchestrating-development-review-log.md)).

### How to use

- **From brainstorming:** when a spec passes its review gate, the gate message offers orchestration as an alternative to the manual writing-plans handoff.
- **Direct:** `orchestrate development of docs/superpowers-orchestrator/<date>-<slug>/specs/<slug>-design.md` — then answer the Phase 0 questions once.
- **After a stop:** `Resume orchestration for docs/superpowers-orchestrator/<date>-<slug>/plans/<slug>.md` (supply the blocking answer if the stop was a `BLOCKED`); `Abandon orchestration for docs/superpowers-orchestrator/<date>-<slug>/plans/<slug>.md` tears the run down with confirmation.
- **Claude Code only** — the pipeline requires the Agent tool with nested controller dispatch; it is not available on Codex or Cursor.

### Where it lives

`skills/orchestrating-development/` (`SKILL.md` orchestrator + `plan-writer-prompt.md`, `doc-review-loop-prompt.md`, `batch-controller-prompt.md`, `code-review-loop-prompt.md`), the routing entry in `hooks/skill-rules.json`, the gate line in `skills/brainstorming/SKILL.md`, tests in `tests/codex/test-skill-activator.js`.

### References

- Design spec: [superpowers-orchestrator/2026-08-04-orchestrating-development/specs/orchestrating-development-design.md](superpowers-orchestrator/2026-08-04-orchestrating-development/specs/orchestrating-development-design.md)
- Implementation plan: [superpowers-orchestrator/2026-08-04-orchestrating-development/plans/orchestrating-development.md](superpowers-orchestrator/2026-08-04-orchestrating-development/plans/orchestrating-development.md)
- Review logs (dogfood evidence): [spec](superpowers-orchestrator/2026-08-04-orchestrating-development/specs/orchestrating-development-design-review-log.md), [plan](superpowers-orchestrator/2026-08-04-orchestrating-development/plans/orchestrating-development-review-log.md)
- Release notes: [../RELEASE-NOTES.md](../RELEASE-NOTES.md) — v6.14.0
