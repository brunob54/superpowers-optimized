# Review log — secrets-rules-switch plan

_Invocation 1 — 2026-10-09 — N=4 M=1 — gate: orchestration — plan-blob b86f4ab574e676acad0418c37ee0c3260d30f2aa_

## Readiness pre 1 — Execution readiness — claude-sonnet-5-5
**Result:** open
**Reviewer verdict:** 0 Critical, 3 Important, 5 Minor

### Dispositions
- [I1] applied — Task 6: Global Constraints entry 9 says the existing function `check_no_superpowers_defaults_setting` does not change, Task 6 Step 3(b) edited its body → Step 3(b) and the shared function `settings_file_sets_variable` removed; the new function holds its own grep line; the existing function is not edited (Contract, Files, Does NOT cover, File Structure row updated)
- spec deviation: the new test-helper function holds its own copy of the one grep line of the existing function — spec: "sharing its file-reading code" (docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/specs/secrets-rules-switch-design.md, section 9.1) — kept because the same bullet says "The existing function and its list do not change", and sharing needs an edit of that function
- [I2] applied — Task 8: Steps 2, 4 and 8 order repairs of files outside the Task 8 Files list and the `git diff --stat hooks/` invariant → Files lists the possible repairs; each repair is committed under the owning task's trailer; Step 4 puts the constant back before the Task 5 fix; Does NOT cover names that one hook repair
- [I3] applied — Assumptions, third bullet vs Task 8 Step 2: stop versus repair → the assumption now states the repair-once-then-BLOCKED reaction that Step 2 holds
- [M1] rejected: not a conflict — Global Constraints entry 3 says "Codex are not changed or tested"; spec section 3 means no Codex-specific switch test, and spec section 9.1 itself requires the adapter test to clear the variable; the added assertion applies the refusal-text rule of spec section 7.1 to existing cases
- [M2] applied — Task 3 Step 2: the expected-result text said all `deny` cases pass → names the deny cases that also fail until Step 3
- [M3] rejected: not a conflict — spec section 9.2 row "record, no record and no marker" says repeat run B once; the plan repeats both runs, which includes run B
- [M4] applied — Task 9 Step 1 and Task 4 Step 1: duplicated root constant and repeated literal → Task 9 uses the existing `root` of `main`; the adapter test imports `SECRETS_SWITCH` from the helper
- [M5] applied — Task 7: abbreviations JSON and CLI unexpanded in three new files → expanded at first use
coverage: 11 of 11 entries swept (sites checked: 8, 9, 10, 7, 9, 9, 9, 5, 8, 6, 8)

## Readiness pre 2 — Execution readiness — claude-sonnet-5-5
**Result:** open
**Reviewer verdict:** 0 Critical, 2 Important, 5 Minor

### Dispositions
- [I1] applied — Assumptions bullet 1, Task 8 Step 1, Task 10 Step 3: Tasks 9 and 10 stay valid when Task 8 returns BLOCKED, but Task 10 reads the results file → both places now say Tasks 1-7 stay valid and Tasks 9 and 10 wait for the results file
- [I2] rejected: undecidable at this gate — spec inconsistent: spec section 9.1 says the new function is "sharing its file-reading code" and, in the same bullet, "The existing function and its list do not change"; this reverses the amendment of Readiness pre 1 [I1]. The plan now states the choice in Task 6 "Does NOT cover"
- [M1] applied — Global Constraints entry 3 vs Tasks 3 and 4: the Codex adapter test file is edited → Task 3 "Does NOT cover" names the two edits of that file that spec section 9.1 requires
- [M2] applied — Global Constraints entry 11: stdout, UTC and CLI used before expansion → expanded at first use (Task 7 judge header, README bullet and guide entry of Task 9, Task 10 summary)
- [M3] applied — Task 8 Step 2 vs spec section 9.2 row "record, no record and no marker": the plan repeats both runs → Step 2 states that it repeats both runs because the driver has no mode for run B alone
- spec deviation: Task 8 Step 2 repeats both runs of probe 1 after an inconclusive outcome in which run A has a record — spec: "inconclusive: repeat run B once" (docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/specs/secrets-rules-switch-design.md, section 9.2) — kept because the driver has no mode for run B alone and a repeat of both runs is a superset
- [M4] applied — Global Constraints entry 9: the variable was cleared after the first require of protect-secrets → the clearing now stands directly after the import block (test-protect-secrets.js) and before the adapter require (test-pretool-bash-adapter.js)
- [M5] applied — Task 1 "Does NOT cover": wrong cross-reference to Task 5 → names Tasks 3 and 5


## Readiness pre 3 — Execution readiness — claude-sonnet-5-5
**Result:** open

**Reviewer verdict:** 0 Critical, 1 Important, 3 Minor

### Dispositions
- [I1] rejected: undecidable at this gate — spec inconsistent: Global Constraints entry 3 (spec section 3: "this is not tested") against the edits of `tests/codex/test-pretool-bash-adapter.js` that spec section 9.1 requires; both are fixed text, so the plan keeps the exception in Task 3 "Does NOT cover" and the entry is not amended
- [M1] applied — Task 2 Contract: the log-record sentence said the extras can never overwrite a standard key, but `ts` and `hook` come before them → the sentence names the seven keys that are protected
- [M2] applied — Task 8 Files: step numbers of the owning tasks did not exist → each repair names its owner task and the Task 8 step that orders it
- [M3] applied — Assumption 1 and Task 8 Step 1: Task 9 does not read the results file → only Task 10 waits for it (the unmet clause "sharing its file-reading code" is recorded by the spec deviation line of Readiness pre 1)

## Round 1 — Correctness & completeness — claude-sonnet-5-5
**Reviewer verdict:** 0 Critical, 0 Important, 5 Minor
**Converged:** no

### Dispositions
- [M1] applied — Task 8 Step 4: a BLOCKED return after Step 3 would leave `SYSTEM_MESSAGE_SHIPS = true` in the worktree → Step 4 runs Step 5 before any BLOCKED of that step
- [M2] applied — Task 8 Step 3: the unit checks of the message text run only while the constant is true and no step ran them → Step 3 runs `node tests/codex/test-protect-secrets.js | tail -3` in that state
- [M3] rejected: harness probe not runnable here — with a throwaway project folder whose `.claude/settings.json` sets `SUPERPOWERS_SECRETS_RULES_OFF` to `env-file`, run `claude -p --settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'` there and see whether the branch hook still refuses `cat .env` — (would break a constraint)
- [M4] applied — Task 10 Step 2: the version test cannot end with 0 failed before the new heading exists → Expected names the one check that fails until Step 3
- [M5] applied — Task 3 Step 1(c): no explicit check that each single-pattern value matches one pattern → a mirror case (Stripe key with its pattern off → allow) was added and a comment names the two ALLOW cases as that check

## Round 2 — Ambiguity & testability — claude-sonnet-5-5
**Reviewer verdict:** 0 Critical, 2 Important, 6 Minor
**Converged:** no

### Dispositions
- [I1] applied — Task 8 Step 3 and Task 3 `runSwitched`: with the constant true, two switch cases (unknown names) would output a `systemMessage` that the helper's shape check rejects, so the expected `0 failed` was false → `runSwitched` passes `{ allowSystemMessage: true }`; Step 3 names the repair path
- [I2] applied — Task 7 driver and judge: one token for both kinds made `logHit` of the subagent kind true because of the main run's record → one token per kind, written to `<kind>.token`; the judge reads it per kind
- spec deviation: probe 2 uses one random token for each kind of call — spec: "holds one unknown name made of a random token" (docs/superpowers-orchestrator/2026-10-09-secrets-rules-switch/specs/secrets-rules-switch-design.md, section 9.2) — kept because the hook log is shared by both kinds and one token would make the `logHit` of the subagent kind true because of the main run's record
- [M1] applied — Task 7 Contract: the driver had no stated behaviour → a contract bullet for the driver; its behaviour is verified by the live runs of Task 8
- [M2] applied — Task 8 Step 1: the step cannot see a missing login → the text says it shows in Step 2
- [M3] applied — Task 8 Step 2: the repair condition covered only a missing `plugins` field → widened to a `plugins` array without entries that hold a string `path`
- [M4] applied — Task 8 Step 8: the run does not test the isolation → the text says what it shows
- [M5] applied — Task 5 Step 1(c): no test for "a call that passes because of the switch is not logged" → case added; part (a) (an error inside `unknownNameReport`) deferred, the `readExtra` path is tested in Task 2
- [M6] deferred — verification wording (exit status of `tail`, hand word count, Language constraint source): the visible text `0 failed` is the criterion in every step

## Round 3 — Feasibility & architecture risk — claude-sonnet-5-5
**Reviewer verdict:** 0 Critical, 0 Important, 3 Minor
**Converged:** no

### Dispositions
- [M1] applied — Task 8 Step 2: the command is one foreground call, the text says background → the text names `run_in_background` and tells the executor to copy the folder path
- [M2] deferred — `loadsBranchPlugin` accepts a run in which the installed copy is also listed; low risk, because a run with `--plugin-dir` of the same plugin name replaces the installed copy
- [M3] deferred — the no-argument branch of `check_no_secrets_rules_managed_setting` is not run by a unit test; the two real paths cannot be redirected

## Round 4 — Adversarial failure modes — claude-sonnet-5-5
**Reviewer verdict:** 0 Critical, 0 Important, 5 Minor
**Converged:** yes

### Dispositions
- [M1] rejected: harness probe not runnable here — a `claude -p --plugin-dir <checkout> --settings '{"env":{"SUPERPOWERS_SECRETS_RULES_OFF":""}}'` run of `cat .env` in a scratch folder whose `.claude/settings.json` sets the variable to `env-file` — (would break a constraint)
- [M2] rejected: harness probe not runnable here — open the `init` event of `probe1-a.jsonl` from one run and list its `plugins` entries — (would break a constraint)
- [M3] rejected: harness probe not runnable here — from a dispatched executor of this plan, run one background Bash call and check that its exit re-invokes the agent; also check that a foreground `sleep 30` is refused there — (would break a constraint)
- [M4] deferred — the no-argument branch of `check_no_secrets_rules_managed_setting` is not run by a unit test (same as Round 3 [M3])
- [M5] applied — Task 2 Step 4(c): the new section heading hid the heading of four existing checks → a `report.section('message, log and hook input')` line after the new block

## Readiness post 1 — Execution readiness — claude-sonnet-5-5
**Result:** settled
**Reviewer verdict:** 0 Critical, 0 Important, 4 Minor

### Dispositions
- [M1] rejected: undecidable at this gate — spec inconsistent: Global Constraints entry 3 (spec section 3: "this is not tested") against the edits of `tests/codex/test-pretool-bash-adapter.js` that spec section 9.1 requires (same conflict as Readiness pre 3 [I1]); the exception stays in Task 3 "Does NOT cover"
- [M2] rejected: undecidable at this gate — spec inconsistent: spec section 9.1 "sharing its file-reading code" against "The existing function and its list do not change" (same conflict as Readiness pre 2 [I2]); the plan records the choice in Task 6 and the spec deviation line of Readiness pre 1 [I1]
- [M3] applied — Task 8 "Does NOT cover" and Step 3: the repair of the hook was limited to the log field → names the repairs of Steps 3 and 4
- [M4] applied — Global Constraints entry 11 (no idioms): "get past" and "green" outside the mandated sentence → "avoid" and "pass" in the code comment, the release note and the verification text

## Self-review (writing-plans checklist, after the post-sequence)
- Spec coverage, type consistency and contract audit: no new issue; the readiness and rotating rounds covered them and every applied fix was checked against the spec.
- Placeholder scan and scope-reduction scan: no hit (no TBD, TODO, "for now", "minimal", "simple", "basic", "v1", "placeholder"). The only `**Exact content:**` marker cites spec section 7.1. 10 tasks, 10 `**Contract:**` fields.
- No merge-introduced issue found; no inline fix needed.

Owed:
    - conflict: Global Constraints entry 9, "without changing the existing function `check_no_superpowers_defaults_setting`" — against spec section 9.1, "sharing its file-reading code"; both sides are spec text (undecidable at this gate: spec inconsistent). The plan keeps the existing function unchanged and records a spec deviation (Readiness pre 1 [I1]).
    - conflict: Global Constraints entry 3, "The OpenCode copy and Codex are not changed or tested" — against spec section 9.1, which requires edits of `tests/codex/test-pretool-bash-adapter.js` (undecidable at this gate: spec inconsistent). The plan keeps an exception in Task 3 "Does NOT cover".
    - not a conflict (Readiness pre 1 [M1]): the same Codex wording, read as "no Codex-specific switch test"; later reviewers reported it again, see above.
    - not a conflict (Readiness pre 1 [M3]): probe 1 repeats both runs where the spec says "repeat run B once"; recorded as a spec deviation in Readiness pre 2.

**Host self-review:** done

_Loop complete — 2026-10-09 — rounds 4_
