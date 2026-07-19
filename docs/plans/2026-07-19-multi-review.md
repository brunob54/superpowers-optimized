# Multi-Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `multi-review` skill that runs an N-round independent document-review loop (one clean-context reviewer subagent per round, rotating lens, findings merged between rounds, sidecar audit log) at the brainstorming and writing-plans approval gates and via direct invocation.
**Spec:** `docs/specs/2026-07-19-multi-review-design.md`
**Architecture:** A new skill directory (`skills/multi-review/`) holds the controller procedure (SKILL.md) and the reviewer dispatch template (reviewer-prompt.md). The two host skills gain a one-step integration each. `hooks/subagent-guard.js` gains the new skill in its roster plus a marker-based exemption so reviewer reports that quote skill names are not blocked as leakage. `hooks/skill-rules.json` registers the skill for auto-routing.
**Tech Stack:** Markdown skills, Node >= 16 hooks (no deps), bash behavioral tests invoking the real `claude` CLI.
**Assumptions:**
- Assumes the Task/Agent tool is available (Claude Code) — the loop will NOT run on Codex/Cursor; gate integrations are skipped there (spec Non-Goal).
- Assumes SubagentStop hook input carries `last_assistant_message` (as `tests/codex/test-subagent-guard.js` already relies on) — the marker exemption will NOT work if that field is absent, in which case the guard behaves as today (blocks; reviewer retried per skill error handling).
- Assumes behavioral tests run against a reinstalled plugin cache — editing `skills/` here does NOT change live sessions.

**Global Constraints:**
- Skill name is exactly `multi-review`; slash form `/multi-review <doc-path> [N]`.
- Reviewer report marker, verbatim: `<!-- multi-review report -->` — MUST be the first line of every reviewer final message; the guard exempts only when the message *starts* with it (after leading whitespace). A marker mid-message exempts nothing.
- Review log sidecar: `<doc-basename>-review-log.md` next to the target document. Reviewers are barred from reading `*-review-log.md` files.
- Convergence: loop exits early only after two consecutive clean rounds (reviewer-reported zero Critical and zero Important, read from the **enumerated findings**, never the count line, never post-triage). An `inconclusive` round breaks the streak. With N ≤ 2 no mid-loop exit; the gate report still says "converged" if the final two rounds were clean; N = 1 always reports "cap reached".
- N: integer 0–10; anything else → 3; 0 skips (logged, `skipped`); most recently stated count wins; asked once if not stated.
- Reviewer inputs are ONLY the template placeholders (doc path, doc type, lens name + instructions, spec path for plans). Never the conversation, rationale, prior findings, or the log.
- Reviewer barred from: Skill tool, `*-review-log.md`, other documents under `docs/specs/` and `docs/plans/` (except the spec when reviewing a plan), and the target document's git history.
- Severities: Critical / Important / Minor. `No material issues under this lens.` is used only at zero findings of any severity.
- Triage: every Critical/Important finding is applied OR `rejected: <reason>` — silent drops forbidden. Minor at controller discretion, always logged.
- Once per gate; log invocation notes record date, N, and invoker: `gate: brainstorming` | `gate: writing-plans` | `direct`.
- Version bump to **6.9.0** in ALL of: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml` (meta version), plus a `RELEASE-NOTES.md` entry.

---

## File Structure

- Create: `skills/multi-review/SKILL.md` — controller: parameters, loop, lens rotation, triage, log format, error handling, gate notes.
- Create: `skills/multi-review/reviewer-prompt.md` — dispatch template (`[PLACEHOLDER]` style, mirrors `task-reviewer-prompt.md`).
- Modify: `hooks/subagent-guard.js` — roster + marker exemption. Test: `tests/codex/test-subagent-guard.js`.
- Modify: `hooks/skill-rules.json` — routing entry.
- Modify: `skills/brainstorming/SKILL.md` — gate step 11, digraph, exit criteria, once-per-gate note.
- Modify: `skills/writing-plans/SKILL.md` — `**Spec:**` header line, gate section, handoff wording.
- Delete: `skills/brainstorming/spec-document-reviewer-prompt.md`, `skills/writing-plans/plan-document-reviewer-prompt.md` (orphaned).
- Create: `tests/claude-code/test-multi-review.sh` — behavioral test (slow suite).
- Modify: version/release files (see Global Constraints).

### Task 1: Subagent-guard roster + marker exemption (TDD)

**Files:**
- Modify: `hooks/subagent-guard.js`
- Test: `tests/codex/test-subagent-guard.js`

**Security flag:** `none`

**Does NOT cover:** the exemption fires only when the marker opens the message — it does NOT exempt markers appearing later, other hook events, or non-reviewer subagents that deliberately spoof the marker (accepted: the guard is an accident-prevention heuristic, not a security boundary; spoofing is out of scope per spec Limitations).

- [x] **Step 1: Write failing tests**

In `tests/codex/test-subagent-guard.js`, insert immediately before the final summary block (`console.log(`\nsubagent-guard: ...`)`):

```js
// ── multi-review ─────────────────────────────────────────────────────────────

console.log('\nmulti-review');

test('Includes multi-review skill in roster', () => {
  assert.ok(source.includes("'multi-review'"), 'Missing multi-review skill');
});

test('Blocks "using multi-review" without marker', () => {
  const out = runGuard('I completed the task by using multi-review on the doc.');
  assert.strictEqual(out.decision, 'block');
});

test('Marker-prefixed report quoting skill names is exempt', () => {
  const report = [
    '<!-- multi-review report -->',
    '### Verdict',
    'Critical: 0 | Important: 1 | Minor: 0',
    '',
    '### Findings',
    '#### Important',
    '- [I1] Section 2: the doc tells implementers to start using brainstorming before invoking writing-plans | contradicts section 4 | reword',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});

test('Marker mid-message does not exempt', () => {
  const out = runGuard('I was invoking brainstorming.\n<!-- multi-review report -->');
  assert.strictEqual(out.decision, 'block');
});

test('Leading whitespace before marker still exempts', () => {
  const report = [
    '',
    '  <!-- multi-review report -->',
    '### Verdict',
    'Critical: 0 | Important: 1 | Minor: 0',
    '',
    '### Findings',
    '#### Important',
    '- [I1] Section 3: the doc recommends using brainstorming here | wrong gate | reword',
  ].join('\n');
  const out = runGuard(report);
  assert.deepStrictEqual(out, {});
});
```

*(Both exemption tests carry a verb+skill-name phrase — "using brainstorming" — so they genuinely block without the exemption; a message without such a phrase can never detect an exemption regression.)*

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/codex/test-subagent-guard.js`
Expected: FAIL on exactly four of the five new tests — the roster source check ("Missing multi-review skill"), the "Blocks 'using multi-review'" test (nothing matches yet, guard returns `{}` instead of `block`), and the two marker-exemption tests get `decision: 'block'` instead of `{}` — while the mid-message test already passes. (Net: tests 1, 2, 3, 5 fail; test 4 passes.)

- [x] **Step 3: Implement minimal change**

In `hooks/subagent-guard.js`:

(a) Append to `SKILL_NAMES` (after `'dependency-management',`):

```js
  'multi-review',
```

(b) Add the marker constant after the `SKILL_NAMES` array:

```js
// Multi-review reviewer reports legitimately quote skill names — they review
// documents about skills. A genuine report opens with this exact marker
// (reviewer-prompt.md makes it the mandatory first line); anything after the
// start of the message does not count.
const REVIEW_REPORT_MARKER = '<!-- multi-review report -->';
```

(c) In `main()`, after `const agentType = ...` and before the `for (const pattern ...)` loop:

```js
      if (lastMessage.trimStart().startsWith(REVIEW_REPORT_MARKER)) {
        process.stdout.write('{}');
        return;
      }
```

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/codex/test-subagent-guard.js && bash tests/codex/run-unit-tests.sh`
Expected: PASS, all suites green.

- [x] **Step 5: Commit**

```bash
git add hooks/subagent-guard.js tests/codex/test-subagent-guard.js
git commit -m "subagent-guard: multi-review roster entry + marker-exempt reviewer reports"
```

### Task 2: Reviewer dispatch template

**Files:**
- Create: `skills/multi-review/reviewer-prompt.md`

**Security flag:** `none`

- [x] **Step 1: Create the file with exactly this content**

````markdown
# Document Reviewer Prompt Template

Use this template when dispatching a multi-review reviewer subagent. One
reviewer per round; the lens comes from SKILL.md's Lens Rotation table.

**Purpose:** Independent review of one document under one lens, with no
authoring context and no knowledge of prior rounds.

The marker line in the output format is load-bearing: `hooks/subagent-guard.js`
exempts messages that OPEN with it from skill-leakage blocking. Without it,
reports quoting skill names get blocked and the round degrades to a retry.

```
Agent tool (general-purpose):
  description: "multi-review round [ROUND]: [LENS_NAME]"
  model: inherit the session model — do NOT set a model override
  prompt: |
    You are an independent document reviewer. You review ONE document under
    ONE lens and report findings. You have no other tasks.

    ## Subagent Rules

    - Do NOT invoke any skills from any plugin. Do NOT use the Skill tool.
    - Do NOT read any file whose name matches `*-review-log.md`.
    - Do NOT read any other documents under `docs/specs/` or `docs/plans/`
      — [DOC_SCOPE_RULE].
    - Do NOT inspect the git history of the target document (no `git log`,
      `git blame`, or `git show` on it).
    - You MAY read the rest of the repository to check the document's
      claims against reality.
    - Your review is read-only: do not modify any file.

    ## Target

    Document: [DOC_PATH]
    Document type: [DOC_TYPE]
    [SPEC_LINE]

    ## Lens (your ONLY focus in this review)

    **[LENS_NAME].** [LENS_INSTRUCTIONS]
    Do not report issues belonging to other lenses — other rounds cover them.

    "No material issues under this lens" is a legitimate verdict. Inventing
    findings to fill a report is a review failure.

    ## Calibration

    - **Critical** = acting on the document as written would produce wrong
      or broken results for a core scenario.
    - **Important** = the document cannot be trusted until fixed — a
      contradiction, a missed requirement, an ambiguity that changes
      implementation, an assumption that does not hold.
    - **Minor** = polish, "could be broader."

    ## Output format

    Your final message is the report itself — no preamble, no process
    narration. Its FIRST line must be exactly:

    <!-- multi-review report -->

    Then:

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

    Every finding must reference a section or line of the target document.
    Use "No material issues under this lens." only when you have zero
    findings of any severity; a Minor-only review reports counts with empty
    Critical/Important sections.
```

**Placeholders:**
- `[ROUND]` — REQUIRED: round number (display only)
- `[LENS_NAME]` — REQUIRED: lens name from SKILL.md's Lens Rotation
- `[LENS_INSTRUCTIONS]` — REQUIRED: the lens instruction text for this doc
  type, copied verbatim from SKILL.md's Lens Instructions
- `[DOC_PATH]` — REQUIRED: absolute path of the target document
- `[DOC_TYPE]` — REQUIRED: `spec`, `plan`, or `general`
- `[DOC_SCOPE_RULE]` — REQUIRED: for `plan` docs use "the target document and
  the spec listed below are the only documents you may read there"; otherwise
  "the target document below is the only document you may read there"
- `[SPEC_LINE]` — for `plan` docs: `Spec the plan implements (you may read
  it): [SPEC_PATH]`; omit the line entirely for other doc types
- `[SPEC_PATH]` — REQUIRED for `plan` docs (inside `[SPEC_LINE]`): absolute
  path of the spec the plan implements; never used for other doc types

**Nothing else may be added to the prompt.** The conversation, design
rationale, prior rounds' findings, and the review log are never passed.

**Reviewer returns:** marker line, Verdict counts, findings by severity with
doc-section references.
````

- [x] **Step 2: Verify**

Run: `grep -c "multi-review report" skills/multi-review/reviewer-prompt.md && grep -c "\[LENS_INSTRUCTIONS\]" skills/multi-review/reviewer-prompt.md`
Expected: both counts ≥ 1 (marker present in the prompt's output-format block; placeholder both used in the prompt and documented in the Placeholders list).

- [x] **Step 3: Commit**

```bash
git add skills/multi-review/reviewer-prompt.md
git commit -m "multi-review: reviewer dispatch template"
```

### Task 3: multi-review SKILL.md

**Files:**
- Create: `skills/multi-review/SKILL.md`

**Security flag:** `none`

**Does NOT cover:** running the loop on non-Markdown files, per-round user approval, or platforms without the Agent tool (spec Non-Goals). Does not re-trigger at a gate where an invocation entry already exists — only an explicit user request re-runs it.

- [x] **Step 1: Create the file with exactly this content**

````markdown
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
````

- [x] **Step 2: Verify**

Run: `grep -c "consecutive clean" skills/multi-review/SKILL.md && grep -c "gate: brainstorming" skills/multi-review/SKILL.md && grep -n "name: multi-review" skills/multi-review/SKILL.md`
Expected: first count ≥ 2 (the full phrase "two consecutive clean rounds" is line-wrapped in the file — grep the fragment that stays on one line), second ≥ 1, and the frontmatter name line found.

- [x] **Step 3: Commit**

```bash
git add skills/multi-review/SKILL.md
git commit -m "multi-review: controller skill (loop, lenses, triage, audit log)"
```

### Task 4: Register in skill-rules.json

**Files:**
- Modify: `hooks/skill-rules.json`
- Test: `tests/codex/run-unit-tests.sh` (existing harness)

**Security flag:** `none`

- [x] **Step 1: Add the rule**

Append to the `"rules"` array (keep JSON valid — comma after the previous last entry):

```json
    {
      "skill": "multi-review",
      "type": "workflow",
      "priority": "high",
      "keywords": ["multi review", "multi-review", "review rounds", "independent review", "independent reviews", "review the spec", "review the plan", "spec review", "plan review"],
      "intentPatterns": ["review\\s+(the\\s+|this\\s+|my\\s+)?(spec|plan|document)\\s+(again|\\d+\\s+times)", "(run|do|perform)\\s+\\d+\\s+(independent\\s+)?review\\s+rounds?", "(several|multiple|independent)\\s+reviews?\\s+of\\s+(the\\s+|this\\s+|my\\s+)?(spec|plan|document)"]
    }
```

- [x] **Step 2: Verify JSON and regexes parse**

Run: `node -e "const r=require('./hooks/skill-rules.json').rules; const m=r.find(x=>x.skill==='multi-review'); if(!m) throw new Error('entry missing'); m.intentPatterns.forEach(p=>new RegExp(p)); console.log('ok', m.keywords.length, m.intentPatterns.length)"`
Expected: `ok 9 3`

- [x] **Step 3: Run the unit suite**

Run: `bash tests/codex/run-unit-tests.sh`
Expected: PASS. If `test-skill-activator.js` asserts a fixed rules count or skill roster (check with `grep -n "multi-review\|rules.length\|skills = \[" tests/codex/test-skill-activator.js`), the edit is mechanical: append `'multi-review'` to the asserted roster array, or increment the asserted count by exactly 1 — nothing else. Re-run until green.

- [x] **Step 4: Register in the skill-triggering suite**

Create `tests/skill-triggering/prompts/multi-review.txt` with exactly:

```
I want to run several independent reviews of the spec and merge the issues they find before I approve it.
```

Then append `multi-review` to the `SKILLS` array in `tests/skill-triggering/run-all.sh` (locate it with `grep -n "SKILLS" tests/skill-triggering/run-all.sh`).

Verify registration: `grep -n "multi-review" tests/skill-triggering/run-all.sh && test -f tests/skill-triggering/prompts/multi-review.txt && echo ok`
Expected: the array line and `ok`. (Actually running `tests/skill-triggering/run-all.sh` needs the reinstalled plugin — deferred to post-reinstall, same as Task 8.)

- [x] **Step 5: Commit**

```bash
git add hooks/skill-rules.json tests/codex/test-skill-activator.js tests/skill-triggering/prompts/multi-review.txt tests/skill-triggering/run-all.sh
git commit -m "skill-rules: route multi-review (keywords + intent patterns + triggering test)"
```

*(If test-skill-activator.js needed no change, omit it from the add.)*

### Task 5: Brainstorming gate integration

**Files:**
- Modify: `skills/brainstorming/SKILL.md`

**Security flag:** `none`

**Does NOT cover:** re-running the loop after user-requested spec changes (once-per-gate; explicit user request only) and non-Claude-Code platforms (loop skipped, self-review still runs).

- [x] **Step 1: Insert checklist step**

Replace:

```markdown
11. **User reviews written spec** — ask user to review the spec file before proceeding (see User Review Gate below).
12. Invoke `writing-plans`.
```

with:

```markdown
11. **Multi-round spec review** — invoke `superpowers-optimized:multi-review` on the saved spec (doc type `spec`). It asks for N if not already stated (default 3; 0 skips), runs at most once per gate, and writes its audit log to `<spec-basename>-review-log.md`. Skip on platforms without the Agent tool.
12. **User reviews written spec** — ask user to review the spec file before proceeding (see User Review Gate below).
13. Invoke `writing-plans`.
```

- [x] **Step 2: Update the digraph**

Replace:

```dot
    "Spec self-review\n(fix inline)" -> "User reviews spec?";
```

with:

```dot
    "Spec self-review\n(fix inline)" -> "Multi-review loop";
    "Multi-review loop" -> "User reviews spec?";
```

and add, with the other node declarations:

```dot
    "Multi-review loop" [shape=box];
```

- [x] **Step 3: Add the once-per-gate note to User Review Gate**

Append to the "User Review Gate" section (after "Only proceed once the user approves."):

```markdown
If the user requests changes after the multi-review loop already ran at this
gate, re-run only the Spec Self-Review on the edited spec — the loop runs at
most once per gate (detection: the spec's `-review-log.md` already holds an
invocation entry from this gate). Run the loop again only if the user
explicitly asks.
```

- [x] **Step 4: Add exit criterion**

In "Exit Criteria", after the spec self-review line, add:

```markdown
- Multi-review loop completed or explicitly skipped (N=0) — every Critical/Important finding applied or rejected-with-reason in the review log.
```

- [x] **Step 5: Verify**

Run: `grep -in "multi-review" skills/brainstorming/SKILL.md | wc -l`
Expected: ≥ 5 — case-insensitive is required: the checklist step and gate note say "multi-review", while the exit-criteria line and the three digraph occurrences say "Multi-review".

- [x] **Step 6: Commit**

```bash
git add skills/brainstorming/SKILL.md
git commit -m "brainstorming: multi-review loop before the user spec gate"
```

### Task 6: Writing-plans gate integration + Spec header line

**Files:**
- Modify: `skills/writing-plans/SKILL.md`

**Security flag:** `none`

**Does NOT cover:** pre-existing plans without a `**Spec:**` line (multi-review asks the user once — handled in the multi-review skill, not here).

- [x] **Step 1: Add the Spec line to the Plan Header template**

In the "Plan Header" fenced template, after the `**Goal:**` line, insert:

```markdown
**Spec:** `docs/specs/<the spec this plan implements>.md` *(multi-review reads this line to locate the spec on direct plan reviews)*
```

- [x] **Step 2: Add the gate section**

Insert a new section between "Self-Review" and "Execution Handoff":

```markdown
## Multi-Round Plan Review

After self-review, invoke `superpowers-optimized:multi-review` on the saved
plan (doc type `plan`; spec path from the plan header's `**Spec:**` line).
It asks for N if not already stated (default 3; 0 skips), runs at most once
per gate, and writes its audit log to `<plan-basename>-review-log.md`. If
the user requests plan changes afterward, re-run only Self-Review — another
loop pass only on explicit user request. Skip on platforms without the
Agent tool.
```

- [x] **Step 3: Update the handoff opener**

Replace:

```markdown
After saving the plan and completing self-review, auto-select the execution approach
```

with:

```markdown
After saving the plan, completing self-review, and completing the multi-round plan review, auto-select the execution approach
```

- [x] **Step 4: Verify**

Run: `grep -n "Multi-Round Plan Review\|\*\*Spec:\*\*" skills/writing-plans/SKILL.md | wc -l`
Expected: ≥ 3 (header line, section title, section body reference).

- [x] **Step 5: Commit**

```bash
git add skills/writing-plans/SKILL.md
git commit -m "writing-plans: Spec header line + multi-review loop before handoff"
```

### Task 7: Delete orphaned single-shot reviewer templates

**Files:**
- Delete: `skills/brainstorming/spec-document-reviewer-prompt.md`
- Delete: `skills/writing-plans/plan-document-reviewer-prompt.md`

**Security flag:** `none`

- [x] **Step 1: Confirm they are still orphaned, then remove**

Run: `git grep -lE "spec-document-reviewer-prompt|plan-document-reviewer-prompt" -- ':!docs'`
Expected: only `RELEASE-NOTES.md` — historical entries stay; `docs/` is excluded because this feature's own spec, plan, and review log legitimately name the deleted files. (`git grep` is used deliberately: its output format is stable, while plain `grep` on this machine is ugrep, which prints paths without a `./` prefix.) Then:

```bash
git rm skills/brainstorming/spec-document-reviewer-prompt.md skills/writing-plans/plan-document-reviewer-prompt.md
```

- [x] **Step 2: Verify**

Run: `ls skills/brainstorming/ skills/writing-plans/`
Expected: each directory contains only `SKILL.md`.

- [x] **Step 3: Commit**

```bash
git commit -m "Remove orphaned single-shot document reviewer templates (superseded by multi-review)"
```

### Task 8: Behavioral test

**Files:**
- Create: `tests/claude-code/test-multi-review.sh`

**Security flag:** `none`

**Does NOT cover:** gate-integration behavior (brainstorming/writing-plans invoking the loop) — that is the spec's Manual gate check after plugin reinstall, not automatable here; and it cannot assert specific findings (reviewer output is nondeterministic), only the contract: log exists, round entry present, doc-modification consistent with dispositions.

- [x] **Step 1: Create the file with exactly this content**

```bash
#!/usr/bin/env bash
# Test: multi-review skill — N-round document review loop (behavioral, slow)
#
# Seeds a deliberately flawed spec, invokes the skill headlessly with N=2,
# and asserts the review-log contract from
# docs/specs/2026-07-19-multi-review-design.md:
#   (a) sidecar <doc-basename>-review-log.md exists with a Round 1 entry
#   (b) doc modified OR all Critical/Important dispositions are rejections
#   (c) log has a disposition line or an explicit no-findings verdict
#
# Requires the INSTALLED plugin to include multi-review — reinstall the
# plugin cache after editing skills/ before running this.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

TEST_PROJECT=$(create_test_project)
trap "cleanup_test_project '$TEST_PROJECT'" EXIT

mkdir -p "$TEST_PROJECT/docs/specs"
SPEC="$TEST_PROJECT/docs/specs/test-feature-design.md"
cat > "$SPEC" << 'SPEC_EOF'
# Test Feature Design

## Requirements
- The exporter writes CSV files to the output directory.
- The exporter never writes any file to disk.

## Retry Behavior
Failed exports are retried a reasonable number of times.
SPEC_EOF
SPEC_SHA_BEFORE=$(shasum "$SPEC" | cut -d' ' -f1)

PROMPT="Invoke the superpowers-optimized:multi-review skill on the document $SPEC with N=2. Do not ask me any questions — use N=2 and proceed to completion."
# Deliberately no doc-type statement: the spec's Testing Strategy requires this
# test to exercise path-based inference (docs/specs/ -> spec); stating the type
# would override inference per the skill's Parameters rule.

cd "$PLUGIN_DIR" && timeout 1800 claude -p "$PROMPT" \
    --permission-mode bypassPermissions \
    --add-dir "$TEST_PROJECT" \
    2>&1 | tee "$TEST_PROJECT/output.txt" || true

LOG="$TEST_PROJECT/docs/specs/test-feature-design-review-log.md"
FAILURES=0

if [ ! -f "$LOG" ]; then
    echo "FAIL(a): review log $LOG was not created"
    FAILURES=$((FAILURES+1))
else
    if ! grep -q "^## Round 1" "$LOG"; then
        echo "FAIL(a): review log has no '## Round 1' entry"
        FAILURES=$((FAILURES+1))
    fi
    SPEC_SHA_AFTER=$(shasum "$SPEC" | cut -d' ' -f1)
    if [ "$SPEC_SHA_AFTER" = "$SPEC_SHA_BEFORE" ] && \
       grep -qE "^- \[(C|I)[0-9]+\] applied" "$LOG"; then
        echo "FAIL(b): log claims applied Critical/Important findings but the spec is byte-identical"
        FAILURES=$((FAILURES+1))
    fi
    if ! grep -qiE "applied|rejected:|deferred|no material issues|skipped|inconclusive" "$LOG"; then
        echo "FAIL(c): log has no disposition line and no no-findings verdict"
        FAILURES=$((FAILURES+1))
    fi
fi

if [ "$FAILURES" -eq 0 ]; then
    echo "PASS: multi-review behavioral test"
else
    echo "FAILED: $FAILURES assertion(s); transcript in $TEST_PROJECT/output.txt"
    exit 1
fi
```

- [x] **Step 2: Syntax-check and register**

Run: `bash -n tests/claude-code/test-multi-review.sh && chmod +x tests/claude-code/test-multi-review.sh && grep -n "test-" tests/claude-code/run-skill-tests.sh | head -20`
Expected: no syntax errors. If `run-skill-tests.sh` enumerates test files explicitly, the edit is mechanical: append `test-multi-review.sh` to the same list/array/case that contains `test-subagent-driven-development-integration.sh` (the **integration**/slow set — this test runs the real CLI for up to 30 minutes), matching the surrounding syntax exactly; if discovery is glob-based, no change.

- [x] **Step 3: Commit**

```bash
git add tests/claude-code/test-multi-review.sh tests/claude-code/run-skill-tests.sh
git commit -m "Behavioral test: multi-review log contract on a seeded flawed spec"
```

*(If run-skill-tests.sh needed no change, commit only the test file. Actually running the test happens after the v6.9.0 plugin reinstall — record the outcome in the PR, not this task.)*

### Task 9: Version bump 6.9.0 + release notes

**Files:**
- Modify: `VERSION`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.universal.yaml`, `RELEASE-NOTES.md`

**Security flag:** `none`

- [ ] **Step 1: Bump all four version fields to 6.9.0**

`VERSION` → `6.9.0`; `"version": "6.9.0"` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; `version: "6.9.0"` in `plugin.universal.yaml` meta.

- [ ] **Step 2: Prepend a RELEASE-NOTES.md entry**

```markdown
## v6.9.0 — multi-review: N-round independent document review

- New `multi-review` skill: runs up to N (default 3, cap 10) independent
  review rounds on a spec or plan — one clean-context reviewer subagent per
  round under a rotating lens (correctness, ambiguity, feasibility,
  adversarial) — merging Critical/Important findings between rounds, with a
  sidecar `<doc>-review-log.md` audit trail and early exit after two
  consecutive clean rounds.
- brainstorming and writing-plans invoke the loop automatically before their
  user approval gates (once per gate); direct use: `/multi-review <doc> [N]`.
- writing-plans Plan Header gains a `**Spec:**` line so plan reviews can
  locate their spec.
- subagent-guard: reviewer reports (marker `<!-- multi-review report -->`)
  are exempt from skill-leakage blocking; `multi-review` added to the roster.
- Removed orphaned `spec-document-reviewer-prompt.md` /
  `plan-document-reviewer-prompt.md` (superseded).
```

- [ ] **Step 3: Verify**

Run: `cat VERSION && grep -h '"version"' .claude-plugin/plugin.json .claude-plugin/marketplace.json && grep -c 'version: "6.9.0"' plugin.universal.yaml && head -3 RELEASE-NOTES.md`
Expected: `6.9.0` in VERSION and both JSON files, yaml count exactly `1` (the meta version — an exact-string match, immune to other `version:` keys), release-notes entry on top.

- [ ] **Step 4: Commit**

```bash
git add VERSION .claude-plugin/plugin.json .claude-plugin/marketplace.json plugin.universal.yaml RELEASE-NOTES.md
git commit -m "v6.9.0 - multi-review skill, gate integrations, guard exemption"
```

- [ ] **Step 5: Reinstall the plugin cache at 6.9.0**

Sessions run the installed copy, not this repo, and the marketplace pointer
demonstrably lags the repo (installed: 6.6.1 while the repo was at 6.8.0) —
so the ACTIVE version dir is the primary install target, not a new one:

```bash
CACHE_ROOT="$HOME/.claude/plugins/cache/superpowers-optimized/superpowers-optimized"
ACTIVE=$(ls "$CACHE_ROOT")   # the currently loaded version dir(s)
echo "active: $ACTIVE"
# extract over the active dir (mainline), and into 6.9.0 for when the pointer advances
for d in $ACTIVE 6.9.0; do
  mkdir -p "$CACHE_ROOT/$d"
  git archive HEAD | tar -x -C "$CACHE_ROOT/$d"
done
```

Verify: `ls "$CACHE_ROOT/$ACTIVE/skills/multi-review/SKILL.md"` → file exists;
confirm a fresh session's start banner shows the multi-review skill available.
This step is the prerequisite for Task 4 Step 4's triggering run, Task 8's
behavioral run, and Step 6 below.

- [ ] **Step 6: Manual gate check (after reinstall)**

Run brainstorming end-to-end on a toy feature in a scratch project and
confirm the multi-review loop fires between spec self-review and the user
review gate (spec Testing Strategy, item 3). Record the outcome (fired / did
not fire, N asked, log created) in the PR description alongside the
behavioral-test result from Task 8.
