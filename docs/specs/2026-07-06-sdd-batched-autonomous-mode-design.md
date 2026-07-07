# Batched Autonomous Mode for subagent-driven-development — Design

Date: 2026-07-06
Status: Approved pending user spec review
Origin: docs/BB/implement_with_handoff.md (deliberation + brainstorming, this session)

## Problem

Executing a long plan in one session bloats the orchestrator's context until Auto Compact fires mid-implementation, destroying file paths and discovered facts. Sessions also stop for external reasons (usage limits). Today there is no first-class way to (a) bound orchestrator context per session and (b) resume execution cleanly in a fresh session after `/clear`.

## Scope

Add a **Batched Autonomous Mode** section to `skills/subagent-driven-development/SKILL.md`:

- Batch execution loop: implement up to X tasks per session, each task via a fresh implementer subagent with full SDD review gates.
- Context-pressure batch boundary: stop the batch when estimated context usage crosses 60%, reusing the v6.6.1 pressure-estimation logic.
- Handoff document written at batch end into `state.md`, sufficient for a fresh session to resume after `/clear`.
- Explicit autonomy policy: no user interaction inside a batch.
- Cold-start resume procedure.

## Non-Goals

- Automatic `/clear` — the session cannot clear itself. Each batch boundary costs the user two actions: `/clear`, then the printed resume prompt.
- Per-task handoff rewrites (per-task durability comes from plan.md checkboxes + git commits, which SDD already writes).
- Crash-safe narrative: a mid-batch death may lose the current batch's narrative, never the position.
- Protecting `state.md` from unrelated sessions overwriting it (accepted limitation; position survives in plan.md + git).
- Cross-project or parallel-session resume.

## Batch Loop

Trigger: user asks to execute a plan in batches ("implement the next N tasks", "execute the plan in batches"), or the resume procedure (below) starts a new batch.

For each task, unchanged SDD mechanics: dispatch implementer subagent → spec-compliance review → code-quality review (security pre-review for flagged tasks) → update `plan.md` checkbox → commit.

After each task, evaluate the batch boundary. End the batch when ANY of:

1. **Context pressure ≥ 60%** (primary boundary).
2. **X tasks completed**, when the user gave an explicit X (X is a cap, not a target).
3. **Plan complete.**
4. **Blocker** (see Autonomy Policy).

On batch end: write the handoff (below), then stop with a message that states what was completed, any open issues, and the verbatim resume instructions (`/clear`, then the exact resume prompt). Exception: if the batch ended because the plan is complete, skip the resume instructions and proceed to the final whole-branch review and `finishing-a-development-branch`.

Execution inside a batch is strictly sequential — SDD's Parallel Waves default does not apply, because the batch boundary must be evaluated after every task. *(Amended 2026-07-07 during execution, quality-review finding.)*

## Context Pressure Measurement

- Reuse the pressure-estimation logic in `hooks/skill-activator.js` (input + cache_creation + cache_read of the last assistant turn vs. 200K window), exposed as a node CLI entry point the orchestrator invokes via Bash between tasks.
- Session file selection: the most recently modified session JSONL under the encoded-cwd project directory.
- **Fallback:** if measurement fails, is ambiguous (e.g. concurrent sessions), or returns implausible values, fall back to a conservative fixed cap of **3 tasks per batch**. Never let a failed measurement extend a batch.

## Handoff Document

The handoff **is** `state.md` at the project root — the existing session-start machinery and context-management skill already discover it; no new artifact.

Contract (hard cap 100 lines):

```markdown
# State
## Current Goal        — one line
## Plan                — path to plan.md + "Next task: N — <title>"
## Batch Summary       — one line per task completed THIS batch
## Decisions & Deviations — choices made autonomously, with one-line why
## Discovered Constraints — forward-relevant facts (paths, gotchas, versions)
## Open Issues         — blockers and questions for the user; mark blocking ones
## Resume Instructions — the exact prompt to paste after /clear
```

Rules:

- No cumulative re-summarizing: completed work lives in `plan.md` checkboxes and git history. Carry forward only facts a future batch needs.
- Written once per batch, at batch end (full rewrite of the plan-execution sections).
- Durability layering: per-task position durability = checkbox + commit (already incremental); per-batch narrative durability = this handoff.

## Autonomy Policy (inside a batch)

Never ask the user mid-batch. Replaces SDD's ask-the-user paths as follows:

- **NEEDS_CONTEXT:** orchestrator answers from the plan, spec, and repo. If it cannot, treat as BLOCKED.
- **BLOCKED / plan ambiguity / verification fails 2+ times:** end the batch early. Journal the blocker and the specific question under Open Issues (marked blocking). Do NOT best-guess plan ambiguities. This supersedes SDD's entire BLOCKED escalation list inside a batch: autonomous remedies (more context, stronger model, task splitting) may be attempted first, but user escalation and skip-and-advance are replaced by end-batch-and-journal. *(Amended 2026-07-07.)*
- The batch-end message surfaces blocking questions prominently; answers arrive in the resume prompt and are recorded under Decisions & Deviations.

Review gates are NOT relaxed: full spec + quality review per task. Autonomous runs have nobody watching — gates matter more.

## Resume Procedure (fresh session after /clear)

1. Read `state.md`; read the plan at the recorded path; read recent `git log`.
2. **Reconcile:** `plan.md` checkboxes + git are authoritative for position; `state.md` is narrative and may be stale. Before dispatching the first unchecked task, check `git log` for evidence it was already implemented (crash between commit and checkbox); if so, check it off and advance.
3. If Open Issues contains a blocking question, present it and stop — do not execute past an unanswered blocker. Record the user's answer in the handoff.
4. Start the next batch at the first genuinely unchecked task.

## Testing Strategy

- **Unit (fast, Node):** extend `tests/codex/test-skill-activator.js` to cover the pressure CLI entry point — valid JSONL, missing file, ambiguous/concurrent sessions → fallback signal.
- **Integration (headless claude, slow):** new test in `tests/claude-code/` — sample plan, run with X=1; assert handoff sections exist in `state.md` and checkbox updated; simulate `/clear` (fresh invocation) with the resume prompt; assert task 2 executes and task 1 is not re-implemented.
- **Trigger tests:** add prompts for "implement the next N tasks" and "resume the plan" to `tests/skill-triggering/`.

## Rollout

- Edit `skills/subagent-driven-development/SKILL.md` (new mode section) — description frontmatter gains batch/resume trigger phrases.
- Update `hooks/skill-rules.json` (SDD entry: keywords/intentPatterns for batch + resume phrasing).
- Add the CLI entry point to `hooks/skill-activator.js` (or a small extracted module shared with it).
- Standard release checklist: bump `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (+ `plugin.universal.yaml` meta), add `RELEASE-NOTES.md` entry.
- Note: live sessions run the installed copy under `~/.claude/plugins/cache/` — reinstall before behavioral testing.

## Failure Modes Considered

- **Pressure misread/failed** → conservative 3-task fallback cap; explicit X always honored. (Revised into design.)
- **Crash between commit and checkbox** → resume cross-checks git before re-dispatching. (Mitigated in resume step 2.)
- **`state.md` overwritten by unrelated session** → narrative lost, position safe; accepted limitation (non-goal).
- **User resumes past an unanswered blocker** → resume step 3 refuses to proceed. (Mitigated.)
