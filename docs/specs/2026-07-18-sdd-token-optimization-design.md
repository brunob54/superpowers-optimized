# SDD Token Optimization — Port of Upstream v6.0.0 Review Rework

**Date:** 2026-07-18
**Branch:** `BB/handoff+token-optimization`
**Source:** obra/superpowers v6.0.0 (`task-reviewer-prompt.md`, `scripts/{sdd-workspace,task-brief,review-package}`, SKILL.md sections "Pre-Flight Plan Review", "Model Selection", "Constructing Reviewer Prompts", "File Handoffs", "Durable Progress")

## Goal

Capture upstream's measured token/wall-clock savings (~50% time, ~50–60% tokens in their evals) in this fork's `subagent-driven-development` (SDD) skill, without losing fork-specific features: Parallel Waves, Batched Autonomous Mode, subagent shutdown, E2E process hygiene, skill-leakage prevention, cache-optimality rationale.

## Scope

One skill (`skills/subagent-driven-development/`), a small addition to `skills/writing-plans/`, the two SDD behavioral tests, and release bookkeeping.

## Non-Goals

- Upstream's other v6.0.0 content: visual-companion security model, new harness ports (Kimi/Pi/Antigravity), evals submodule migration, worktree relocation, vendor-neutral vocabulary rewrite.
- Per-task Interfaces block and right-sizing guidance in writing-plans (only the Global Constraints block is ported).
- Changes to `requesting-code-review` — the final whole-branch review keeps using `skills/requesting-code-review/code-reviewer.md`.
- Fixing the pre-existing parallel-implementer git-index race in wave mode (tracked in known issues).
- Reviewers seeing beyond their diff: diff-only review can miss cross-file breakage; upstream's mitigations (named-risk spot checks, final whole-branch review) are adopted as-is and this residual risk is accepted.

## Design

### 1. Workspace scripts (new: `skills/subagent-driven-development/scripts/`)

Three bash scripts, ported from upstream. Bash is acceptable: sessions run them via the Bash tool, which is Git Bash on Windows (bash, awk, git all present). They are skill assets, not hooks — the Node>=16 hook constraint does not apply. No `/dev/stdin` usage.

- **`sdd-workspace`** — resolves and creates `<repo-root>/.superpowers/sdd/`, writes a self-ignoring `.gitignore` (`*`) into it, prints the absolute path. Single source of truth for the workspace location. Lives in the working tree (not `.git/`) because agents cannot write into `.git/`.
- **`task-brief PLAN_FILE N [OUTFILE]`** — awk-extracts Task N's full section from the plan (fence-aware heading match) to `task-<N>-brief.md` in the workspace; prints the path; exits 3 if the task heading is not found.
- **`review-package`** — writes a single file containing the commit list, `git diff --stat`, and `git diff -U10`, then prints the path. Two invocation modes:
  - `review-package BASE HEAD [OUTFILE]` — range mode (sequential execution). Output name `review-<base7>..<head7>.diff` so a re-review after fixes gets a fresh, distinctly named file. BASE is the commit recorded before dispatching the implementer — **never `HEAD~1`**, which silently drops all but the last commit of a multi-commit task.
  - `review-package --commits SHA [SHA...] [--out OUTFILE]` — **fork extension for wave mode.** Builds the package from the implementer's reported commit SHAs (`git show -U10` per commit, plus a combined stat), because wave tasks commit interleaved on one branch and a range would mix sibling tasks' changes into the review. Output name derived from first/last SHA.

### 2. Merged task reviewer (new: `task-reviewer-prompt.md`; deleted: `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`)

Upstream's template, with fork adaptations. One reviewer per task returns:

- **Spec Compliance verdict:** ✅ / ❌ (missing, extra, misunderstood) plus **⚠️ "cannot verify from diff"** items for requirements living in unchanged code — reported to the controller instead of the reviewer broadening its search.
- **Quality verdict:** Strengths, then Issues as Critical/Important/Minor with file:line evidence, then `Approved | Needs fixes`.

Behavioral rules carried over verbatim in intent:

- Reviewer reads the diff **file** once; the `-U10` context lines ARE the changed files; no re-running git; no codebase crawling except one focused check per concrete named risk (cross-cutting changes — lock ordering, API contracts, shared state — are legitimate named risks).
- **Read-only:** no mutation of working tree, index, HEAD, or branch state.
- **Distrust the report:** implementer claims and design rationales ("per YAGNI") never downgrade a finding.
- **No test re-runs** of what the implementer already evidenced; focused tests only on specific doubt; heavy validation is recommended, not run.
- Severity calibration: Important = cannot trust the task until fixed; plan-mandated defects are reported as Important, labeled plan-mandated — the human decides.
- Warnings/noise in reported test output are findings.

Fork adaptations:

- The fork's skill-leakage banner ("You are a focused subagent. Do NOT invoke any skills…") is included in the template body.
- `model:` field is **REQUIRED**, referencing the fork's Model Selection table, with upstream's warning that an omitted model silently inherits the session's most expensive one.
- Placeholders: `[MODEL]`, `[BRIEF_FILE]`, `[GLOBAL_CONSTRAINTS]`, `[REPORT_FILE]`, `[BASE_SHA]`/`[HEAD_SHA]` or commit list, `[DIFF_FILE]`.

A fix dispatch addresses spec gaps and quality findings together; one re-review covers both verdicts.

### 3. Implementer prompt rewrite (`implementer-prompt.md`)

Upstream's version, keeping the fork's leakage banner and four-status contract:

- Reads the task **brief file** (single source of requirements; exact values live only there).
- Writes a full report to a **report file** (`task-<N>-report.md`, named after the brief), including TDD RED/GREEN evidence when TDD applies; returns **≤15 lines**: status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commit SHAs + subjects, one-line test summary, concerns, report path. Reported commit SHAs are what wave-mode `review-package --commits` consumes.
- Escalation guidance ("it is always OK to stop"), code-organization guidance, focused-tests-while-iterating/full-suite-before-commit.
- After review findings: fix subagents append to the same report file with re-run covering-test results; reviewers never re-run tests for them.
- `model:` REQUIRED, same as the reviewer.

### 4. SKILL.md changes

- **Core flow and dot graph:** implementer → (record BASE) → `review-package` → single task reviewer → fix cycle → complete. "Dispatch spec reviewer" / "Dispatch code quality reviewer" nodes collapse into one gate. Hard Rules "Do not skip spec review / quality review" become "Do not skip the task review (both verdicts) / Do not accept unresolved findings."
- **New: File Handoffs section** (per upstream): dispatch prompts carry paths, not pasted text; the controller's dispatch contains only placement line, brief path, cross-task interfaces/decisions, ambiguity resolutions, report contract. Explicit ban on pasting accumulated prior-task summaries into later dispatches.
- **New: Pre-Flight Plan Review** — before Task 1, scan the plan for internal conflicts and plan-mandated rubric defects; raise everything as one batched question; clean scan proceeds silently. In Batched Autonomous Mode, a conflict found pre-flight is a blocker → journal and end batch (never best-guess), consistent with the existing autonomy policy.
- **New: Handling Reviewer ⚠️ Items** — controller resolves each ⚠️ itself (it holds the plan and cross-task context); a confirmed gap = failed spec review → fix and re-review.
- **New: Constructing Reviewer Prompts** — no coaching ("do not flag X", pre-rated severity banned); global-constraints block copied verbatim from the plan; Minor findings recorded in the ledger and handed to the final review for triage; final whole-branch review gets its own package (`review-package MERGE_BASE HEAD`); **final-review findings go to ONE fix subagent with the complete list**, never one fixer per finding.
- **New: Durable Progress ledger** — `.superpowers/sdd/progress.md`; on each clean review append `Task N: complete (commits <base7>..<head7>, review clean)`. Authority order stays: plan.md checkboxes + git log are authoritative for position (as Batched Mode already defines); the ledger adds commit ranges for post-compaction recovery and Minor-finding carryover. Check for an existing ledger at skill start; never re-dispatch tasks it marks complete.
- **Model Selection:** keep the fork's haiku/sonnet/opus table; add upstream's rules — always specify the model explicitly (with the silent-inheritance warning), "turn count beats token price" (sonnet floor for reviewers and prose-spec implementers; haiku only when the plan text contains the complete code, or for single-file mechanical fixes), final whole-branch review on opus.
- **Parallel Waves:** review step becomes the single gate; per-task packages built with `review-package --commits` from each implementer's reported SHAs. If an implementer's report omits SHAs, the controller asks that implementer for them — never falls back to a range in wave mode.
- **Batched Autonomous Mode:** "implementer → spec review → quality review" wording becomes "implementer → task review (both verdicts)". Review gates stay unrelaxed. Report files and ledger live in the workspace and survive `/clear`, complementing the existing resume procedure.
- Existing sections preserved as-is: E2E Process Hygiene, Context Isolation + cache rationale, Skill Leakage Prevention, subagent shutdown steps, single-message wave dispatch.

### 5. writing-plans addition

`skills/writing-plans/SKILL.md` gains a short requirement: every plan carries a **Global Constraints** block — rules binding every task (version floors, dependency limits, naming/copy, exact values) copied verbatim from the spec — because SDD's reviewer template consumes it as the reviewer's attention lens. A missing block degrades gracefully: the SDD controller extracts constraints from the spec instead.

### 6. Tests

- `tests/claude-code/test-subagent-driven-development.sh` and `test-subagent-driven-development-integration.sh`: update assertions from the two-stage review to the single task review (dispatch count, verdict presence).
- New fast unit-style test for the scripts (pure bash, no `claude` invocation): `task-brief` extraction incl. fenced-code false headings and missing task; `review-package` range mode multi-commit integrity, distinct filenames per range, `--commits` mode containing exactly the named commits' hunks; `sdd-workspace` idempotency and self-ignoring gitignore. Lives at `tests/sdd-scripts/run-tests.sh`, following the existing per-suite directory convention.

### 7. Release bookkeeping

- Version bump to **6.8.0**: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`; RELEASE-NOTES entry crediting upstream v6.0.0 and documenting the `--commits` fork extension.
- No `hooks/skill-rules.json` change: no skill added or renamed.
- Behavioral testing note: sessions run the installed copy — re-run the `git archive HEAD` reinstall into `~/.claude/plugins/cache/superpowers-optimized/superpowers-optimized/6.6.1/` before any live-session validation.

## Interfaces / contracts summary

| Artifact | Producer | Consumer |
|---|---|---|
| `task-<N>-brief.md` | controller via `task-brief` | implementer, task reviewer |
| `task-<N>-report.md` | implementer (fixes append) | task reviewer, controller |
| `review-<range>.diff` / `review-<shas>.diff` | controller via `review-package` | task reviewer, final reviewer |
| `progress.md` ledger | controller | controller (post-compaction), final reviewer (Minor triage) |
| Global Constraints block | writing-plans | controller → `[GLOBAL_CONSTRAINTS]` |

## Error handling

- `task-brief`: missing plan file → exit 2; unmatched task heading → exit 3 with message. Controller must not dispatch on an empty brief.
- `review-package`: unresolvable SHAs → exit 2. Missing diff file at review time → template's documented fallback (reviewer fetches the range itself) covers sequential mode; wave mode controller regenerates via `--commits`.
- Workspace destroyed by `git clean -fdx` → ledger recovered from `git log`; briefs/packages regenerated on demand.

## Failure modes considered

1. **Wave-mode range contamination** (critical → designed out): `--commits` mode; hard rule against range fallback in waves.
2. **Diff-only review blind spots** (minor → accepted non-goal): mitigated by named-risk checks and the final whole-branch review.
3. **Live-session drift** (minor → process): plugin cache reinstall required before behavioral tests; called out in the plan.

## Testing strategy

Unit: script behaviors (fast bash suite, CI-friendly). Behavioral: updated SDD tests assert the single review gate. Manual: one real SDD run on a toy plan after plugin reinstall, verifying workspace artifacts appear and the controller's context stays free of pasted diffs.
