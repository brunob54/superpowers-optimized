# Multi-Review: Multi-Round Independent Document Review — Design

**Date:** 2026-07-19
**Status:** Draft — pending user approval

## Problem

Today the user manually opens a fresh Claude Code session to review a written
spec, merges its findings back into the document, and repeats ~3 times — then
does the same for the plan. This design automates that loop inside the plugin,
preserving the property that made the manual process valuable: each review is
independent (no authoring context, no prior findings).

## Scope

A new standalone skill `skills/multi-review/` that runs an N-round
review-and-merge loop on a document using subagents, plus small integrations
into the two existing approval gates:

- **brainstorming** — runs the loop on the spec between the spec self-review
  (checklist step 10) and the user review gate (step 11).
- **writing-plans** — runs the loop on the plan between Self-Review and
  Execution Handoff.
- **Direct invocation** — `/multi-review <doc-path> [N]` on any Markdown
  document.

## Non-Goals

- No shell-script orchestration and no separate headless `claude` sessions —
  subagent dispatch (Task tool) only.
- No per-round user approval. The single existing user gate remains the only
  approval point.
- No Codex/Cursor support. Subagent dispatch is Claude Code-only, same as
  subagent-driven-development. On platforms without the Task tool the gate
  integrations are skipped (the inline self-review still runs).
- Does not replace code-review gates on implementation
  (requesting-code-review, SDD task reviews). This reviews *documents*.
- Reviewer severity calibration is guided, not guaranteed (see Limitations).

## Parameters

- **N (round cap):** if the user stated a count in conversation, use it.
  Otherwise ask once at gate time via a single question (default **3**;
  **0** skips the loop entirely, logged as skipped). Invalid input → 3.
- **Doc type:** `spec`, `plan`, or `general` (direct invocation on anything
  else). Determines lens phrasing and reviewer inputs.
- **Reviewer model:** inherit the session model. The dispatch template states
  this explicitly so the model line is never accidentally omitted-but-meant.

## Architecture: The Loop

Controller = the main session executing the skill. All state lives in two
files: the target document and the sidecar review log.

For each round `i` in 1..N:

1. **Dispatch one reviewer subagent** (`general-purpose`, session model) using
   `reviewer-prompt.md` with the round's lens (see Lens Rotation). Inputs are
   ONLY the template placeholders:
   - target doc path
   - doc type
   - lens name + lens instructions (verbatim from the lens table)
   - for `plan` docs additionally the spec path (coverage cannot be judged
     without it)
   No free-form context may be added. The conversation, design rationale,
   prior rounds' findings, and the review log are never passed.
2. **Reviewer reviews and reports** findings in a fixed format (below).
   The reviewer has read access to the codebase for feasibility checks but is
   explicitly barred from: the Skill tool, `*-review-log.md` files, other
   documents under `docs/specs/` and `docs/plans/` (except the spec when
   reviewing a plan), and the git history of the target document.
   "No material issues under this lens" is an explicitly legitimate verdict —
   the prompt states that inventing findings to fill a report is a review
   failure.
3. **Controller triages and merges:**
   - Critical and Important findings: apply the edit to the document, OR
     reject as a false positive **with a stated reason** in the log. Silent
     drops are not permitted.
   - Minor findings: apply at the controller's discretion; always logged with
     disposition.
4. **Append a round entry** to the review log (format below).
5. **Convergence check:** if the reviewer *reported* zero Critical and zero
   Important findings, the loop exits early. Convergence is computed from
   reviewer-reported severities, never post-triage — controller rejections can
   never manufacture convergence.

**After the loop exits** (converged or cap reached): the controller runs the
inline self-review checklist (placeholder scan, internal consistency,
ambiguity, scope) on the final merged document. This catches errors introduced
by the last merge, which no reviewer sees. Then it reports to the user at the
existing gate: rounds run, per-round finding counts, converged vs cap reached,
and the review log path.

**Once per gate:** the loop runs at most once per approval gate. If the user
requests changes at the gate, only the inline self-review re-runs on the
edited document. Another multi-review pass happens only if the user explicitly
asks for one.

## Lens Rotation

One reviewer per round, each round a different lens. For N > 4, lenses cycle
from lens 1 (the document has been revised since, so a re-pass is meaningful).

| Round | Lens | `spec` focus | `plan` focus | `general` focus |
|---|---|---|---|---|
| 1 | Correctness & completeness | Requirement gaps, contradictions, missing error handling | Spec coverage: every spec requirement maps to a task | Factual/internal correctness, missing sections |
| 2 | Ambiguity & testability | Requirements interpretable two ways, unverifiable claims | Placeholder scan, vague steps, missing verification commands | Ambiguous statements, unverifiable claims |
| 3 | Feasibility & architecture risk | Fit against the actual codebase, hidden coupling, cross-platform concerns | Type/signature consistency across tasks, hidden inter-task dependencies | Practicality against the repo it lives in |
| 4 | Adversarial failure modes | "How does this design fail in production?" | "Where does an executing agent go wrong following this?" | "How does acting on this document go wrong?" |

## Reviewer Report Contract

The reviewer's final message is the report (no preamble, no narration):

```
### Verdict
Critical: <n> | Important: <n> | Minor: <n>
(or exactly: "No material issues under this lens.")

### Findings
#### Critical
- [C1] <doc section>: <what is wrong> | <why it matters> | <suggested fix>
#### Important
- [I1] ...
#### Minor
- [M1] ...
```

Every finding must reference a section or line of the target document.
Calibration (adapted from `task-reviewer-prompt.md`): **Critical** = acting on
the document as written would produce wrong or broken results for a core
scenario. **Important** = the document cannot be trusted until fixed — a
contradiction, a missed requirement, an ambiguity that changes implementation.
**Minor** = polish, style, "could be broader."

## Review Log (Audit Trail)

Sidecar file next to the target document: `<doc-basename>-review-log.md`
(e.g. `2026-07-19-multi-review-design-review-log.md`). Created on the first
round; one entry appended per round:

```
## Round <i> — <lens name> — <model>
**Reviewer verdict:** <n> Critical, <n> Important, <n> Minor
**Converged:** yes/no
### Dispositions
- [C1] applied — <doc section>: <finding summary> → <change made>
- [I1] rejected: <reason> — <finding summary>
- [M2] deferred — <finding summary>
```

Rounds where the loop was skipped (N=0) or a reviewer failed twice are logged
as `skipped` / `inconclusive` entries. Reviewers are barred from reading this
file; its predictable `-review-log.md` suffix makes the prohibition
enforceable in the prompt.

## Error Handling

- **Reviewer subagent fails or returns an unusable report** (missing verdict
  block, no findings format): retry once with the identical dispatch. On
  second failure, log the round as `inconclusive` — it never counts as
  convergence — and continue to the next round.
- **Target document missing:** stop and report to the user; nothing dispatched.
- **N invalid** (non-numeric, negative): use default 3. **N = 0:** skip, log.
- **Plan review with no locatable spec:** proceed with lens phrasing that
  omits spec-coverage checks, and record in the log that coverage was not
  reviewed.

## Files

**New:**
- `skills/multi-review/SKILL.md` — controller procedure (loop, triage rules,
  convergence, log format, gate-integration notes).
- `skills/multi-review/reviewer-prompt.md` — dispatch template in the
  established `task-reviewer-prompt.md` style: `[PLACEHOLDER]` slots
  (`[DOC_PATH]`, `[DOC_TYPE]`, `[LENS_NAME]`, `[LENS_INSTRUCTIONS]`,
  `[SPEC_PATH]` for plans), Subagent Rules block, calibration section,
  fixed output format.

**Modified:**
- `skills/brainstorming/SKILL.md` — new checklist step between 10 and 11
  ("Multi-round spec review — invoke `superpowers-optimized:multi-review` on
  the saved spec"), digraph node, exit-criteria line, and the once-per-gate
  rule at the user review gate.
- `skills/writing-plans/SKILL.md` — new step between Self-Review and
  Execution Handoff, plus the once-per-gate rule.
- `hooks/skill-rules.json` — register `multi-review` with keywords
  ("multi review", "review rounds", "independent review", "review the spec",
  "review the plan") and intent patterns
  (e.g. `review\s+(the\s+)?(spec|plan|document)\s+(again|\d+\s+times)`,
  `(run|do)\s+\d+\s+review\s+rounds?`).
- Release bookkeeping per repo policy: `VERSION`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
  (+ `plugin.universal.yaml` meta), `RELEASE-NOTES.md` entry.

## Testing Strategy

- **Unit:** existing hook unit-test harness validates `skill-rules.json`
  structure; add pattern-match cases for the new entry if the harness
  supports per-skill routing assertions (`tests/skill-triggering/` covers
  prompt → skill routing).
- **Behavioral** (`tests/claude-code/`, slow suite): seed a temp project with
  a deliberately flawed spec (one contradiction, one ambiguity), invoke
  `/multi-review <spec> 2` headlessly, assert: (a) the sidecar
  `*-review-log.md` exists with ≥1 round entry, (b) the spec file was
  modified, (c) the log contains a disposition line. Follow existing
  test-script rules: no assertions on hardcoded git history; unique session
  ids per invocation.
- **Manual gate check** after plugin reinstall: run brainstorming end-to-end
  on a toy feature and confirm the loop fires before the user review gate.

## Limitations (accepted, documented)

- **Severity calibration is imperfect.** A reviewer may under- or over-rate
  severity, causing premature convergence or (more likely, per observed
  experience) never converging. The N cap bounds cost; the final user gate is
  the backstop.
- **Independence is enforced by prompt, not sandbox.** The template's
  fixed placeholders prevent context leakage by construction, and the prompt
  bars the review log and doc git history — but a reviewer with repo read
  access could in principle encounter them. Accepted as residual risk.
- **Claude Code only.** Codex/Cursor sessions skip the loop.
