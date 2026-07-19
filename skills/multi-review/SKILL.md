---
name: multi-review
description: >
  MUST USE when a spec or plan document needs N independent review rounds
  with findings merged between rounds. One clean-context reviewer subagent
  per round under a rotating lens; findings triaged into the document; a
  sidecar audit log records every disposition; early exit after two
  consecutive clean rounds. Invoked by brainstorming (spec gate) and
  writing-plans (plan gate), or directly via /multi-review <doc-path> [N].
  Triggers on: "multi review", "review rounds", "independent reviews",
  "review the spec again", "review this N times".
---

# Multi-Review

Run an N-round independent review-and-merge loop on a document using
subagents. Each round is blind to the authoring conversation and to prior
rounds' findings — that independence is the point.

## Parameters

- **Target document:** absolute path, must exist — otherwise stop and report;
  dispatch nothing.
- **N (round cap):** if the user stated a count, use it (most recent wins).
  Otherwise ask once — at gate time for gate invocations, immediately for
  direct invocations. Default **3**. Valid N is an integer 0–10; anything
  else → 3. N = 0 skips the loop and logs a `skipped` entry.
- **Doc type:** gate invocations pass it (brainstorming → `spec`,
  writing-plans → `plan`). Direct invocations infer from path: under
  `docs/specs/` → `spec`, under `docs/plans/` → `plan`, else `general`; an
  explicit user statement overrides. If a `general`-inferred document carries
  a `**Spec:**` header line it is probably a plan at a user-preferred path —
  warn and ask the user to confirm the type instead of proceeding silently.
- **Spec path (plan reviews only):** gate invocations pass it. Direct
  invocations read the plan header's `**Spec:**` line; if absent, ask the
  user once; if unavailable, apply the no-locatable-spec fallback (Error
  Handling).
- **Reviewer model:** inherit the session model (never set an override in
  the dispatch).

## Procedure

Create or open the sidecar log `<doc-basename>-review-log.md` next to the
target document and append an invocation note: date, N, and invoker
(`gate: brainstorming` | `gate: writing-plans` | `direct`). Round numbering
continues across invocations; lens selection does NOT — it uses the
per-invocation round index (round 1 of a re-run uses lens 1, on the by-then
revised document), while the log's `## Round <i>` header uses the continuing
global number.

For each round `i` in 1..N:

1. **Dispatch one reviewer** using `reviewer-prompt.md` with round `i`'s
   lens (Lens Rotation below; for N > 4 cycle from lens 1). Fill ONLY the
   template placeholders. Never pass the conversation, design rationale,
   prior findings, or the log.
2. **Validate the report:** first line is `<!-- multi-review report -->` and
   a Verdict block is present. An unusable report → retry the identical
   dispatch once; on second failure log the round as `inconclusive` and
   continue to the next round.
3. **Triage and merge:** every Critical/Important finding is either applied
   to the document or `rejected: <reason>` — never silently dropped. Minor
   findings: apply at your discretion; log all dispositions either way.
4. **Append the round entry** to the log (format below).
5. **Convergence check:** severities come from the report's enumerated
   findings — the count line is informational; on disagreement the
   enumeration wins. A round is *clean* when it enumerates zero Critical and
   zero Important. Exit the loop early only after **two consecutive clean
   rounds**; an `inconclusive` round breaks the streak. Rejecting findings
   at triage never makes a round clean. With N ≤ 2 no mid-loop exit occurs,
   but still report "converged" if the final two rounds were clean; N = 1
   always reports "cap reached".

**After the loop:** run a self-review on the final merged document — at a
gate, the host skill's own checklist (brainstorming's Spec Self-Review /
writing-plans' Self-Review, already in context); for direct invocations, the
four-item list: placeholder scan, internal consistency, ambiguity, scope.
Fix merge-introduced issues inline and note them in the log. Then report:
rounds run, per-round finding counts, converged vs cap reached, log path.
The host gate's single user approval follows — this skill adds no approvals
of its own.

**Once per gate:** if the log already holds an invocation entry from this
gate for this document, do not re-run the loop (this survives session
restarts). After user-requested changes at the gate, re-run only the host
self-review checklist. Run the loop again only if the user explicitly asks.

## Lens Rotation

| Round | Lens |
|---|---|
| 1 | Correctness & completeness |
| 2 | Ambiguity & testability |
| 3 | Feasibility & architecture risk |
| 4 | Adversarial failure modes |

## Lens Instructions

Copy the cell for the doc type verbatim into `[LENS_INSTRUCTIONS]`.

**Correctness & completeness**
- spec: Find: requirement gaps — scenarios the stated goal implies but the
  document does not cover; internal contradictions; missing error handling —
  failure paths the design will hit but does not specify.
- plan: Find: spec-coverage gaps — spec requirements with no implementing
  task (read the spec listed under Target); contradictions between tasks;
  failure paths the tasks will hit but never handle.
- general: Find: internal incorrectness, contradictions, and missing
  sections the document's stated purpose implies.

**Ambiguity & testability**
- spec: Find: requirements interpretable two different ways — where two
  competent implementers would build different things; unverifiable claims;
  undefined terms or thresholds an implementation would have to guess.
- plan: Find: placeholder patterns (TBD, "add appropriate...", steps without
  code); vague steps; missing or unverifiable verification commands; steps
  interpretable two ways.
- general: Find: ambiguous statements, unverifiable claims, undefined terms.

**Feasibility & architecture risk**
- spec: Find: mismatches between the document and the actual codebase — do
  its assumptions about existing files, components, and tooling hold?;
  hidden coupling with components that may change; cross-platform or
  environment concerns it will hit in practice.
- plan: Find: type, signature, and name inconsistencies across tasks; hidden
  inter-task dependencies; commands or file paths that do not exist in this
  repository.
- general: Find: practicality problems against the repository the document
  lives in.

**Adversarial failure modes**
- spec: Actively try to break the design: name concrete scenarios where it
  fails in production or fails a class of users.
- plan: Where does an agent executing this plan go wrong? Steps likely to be
  misread, orderings that break, verifications that pass vacuously.
- general: How does acting on this document go wrong? Name concrete
  scenarios.

## Review Log Format

Sidecar file next to the target document: `<doc-basename>-review-log.md`.

```
_Invocation <k> — YYYY-MM-DD — N=<n> — <invoker>_

## Round <i> — <lens name> — <model>
**Reviewer verdict:** <n> Critical, <n> Important, <n> Minor
**Converged:** yes/no   <!-- "yes" only on the round where the loop exits
                             via convergence; every other round "no" -->

### Dispositions
- [C1] applied — <doc section>: <finding summary> → <change made>
- [I1] rejected: <reason> — <finding summary>
- [M2] deferred — <finding summary>
```

A clean round (zero findings) writes exactly one disposition line:
`- none — no material issues under this lens`.
Skipped invocations (N=0) get a one-line `skipped` entry under their
invocation note; failed rounds get `inconclusive` entries.

## Error Handling

- Unusable report twice → `inconclusive` round, continue (never counts as
  clean).
- Target document missing → stop and report; nothing dispatched.
- Invalid N (not an integer 0–10) → 3. N = 0 → skip, log.
- Plan with no locatable spec → lens phrasing omits spec-coverage; round 1
  uses the `general` correctness instructions; log that coverage was not
  reviewed.

## Guard Interaction

`hooks/subagent-guard.js` exempts messages opening with
`<!-- multi-review report -->` from skill-leakage blocking — reviewer reports
legitimately quote skill names. Never remove the marker instruction from
`reviewer-prompt.md`; without it, reports about skill-discussing documents
get blocked and rounds degrade to retries.
