# Review log — secrets-rules-switch-design.md

_Invocation 1 — 2026-10-09 — N=4 M=2 — gate: brainstorming_

## Round 1 — Correctness & completeness — claude-opus-5-5
**Reviewers:** M=2, usable 2/2
**Reviewer verdicts:** r1: 0 Critical, 1 Important, 9 Minor | r2: 0 Critical, 1 Important, 6 Minor
**Sources mapped:** 17/17
**Reviewer verdict:** 0 Critical, 2 Important, 9 Minor
**Converged:** no

### Dispositions
- [I1] applied — §9.2: probe 1 named no permission mode and no observable, so a permission denial or a model choice could fake a failure → both probes run with bypassPermissions and their own HOME; probe 1 judged by the hook log record and a marker string; a run without a Bash call is repeated once (harness field dropped: repository-readable) ← 2/2: r1:I1, r2:M6
- [I2] applied — §4, §10, §11: "turning a rule back on needs a restart" contradicted §4, and README.md:411 says a changed value needs a restart → §4 keeps the README's restart instruction as the user-facing rule, the docs fact is marked not verified live, §11 limited to deleting the whole variable, §10 requires consistency with README.md:411 ← 2/2: r1:M1, r2:I1
- [M1] applied — §9.1: helper changes incomplete (hookEnv must keep a case's own value; shape check rejects systemMessage); behavioural test depends on echo-secret-var → three bullets added ← 2/2: r1:M2, r2:M5
- [M2] applied — §6.2, §11: overlap list incomplete, content patterns overlap too, credentials-json is a subset of secrets-file → section rewritten as a rule with examples ← 2/2: r1:M4, r2:M4
- [M3] applied — §4, §6.4: which component removes duplicates was unclear → the helper keeps duplicates (stop-reminders unchanged), protect-secrets removes them ← 2/2: r1:M7, r2:M2
- [M4] applied — §7.1: the stop-reminder precedent was false (its warning names its variable to the model) → sentence corrected, the difference stated as deliberate ← 2/2: r1:M9, r2:M1
- [M5] applied — §9.2: probe 2 relied on the model's answer → random token in the unknown name, unexplained-token question, transcript search as second observation ← 1/2: r1:M3
- [M6] applied — §6.5, §11: other switched-off rows are still content-scanned → behaviour stated as intended and documented ← 1/2: r1:M5
- [M7] applied — §8: runHook's outer catch passes Bash too → variable read inside the decideCommand rules; an error while building extra output writes the plain refusal ← 1/2: r1:M6
- [M8] applied — §10: a refusal reason inside a subagent is not shown to the user → guide entry names the hook log id field as second source (harness field dropped: repository-readable — hooks page states a deny reason is shown to Claude) ← 1/2: r1:M8
- [M9] applied — §4, §10: block-dangerous-commands names copied into the variable switch nothing off silently → stated in §4 and the README bullet ← 1/2: r2:M3

## Round 2 — Ambiguity & testability — claude-opus-5-5
**Reviewers:** M=2, usable 2/2
**Reviewer verdicts:** r1: 0 Critical, 4 Important, 6 Minor | r2: 0 Critical, 4 Important, 5 Minor
**Sources mapped:** 19/19
**Reviewer verdict:** 0 Critical, 6 Important, 7 Minor
**Converged:** no

### Dispositions
- [I1] applied — §7.2, §9.2: probe 2 had two observations per question and no rule when they disagree or when nobody runs the interactive check → (b) the model can read it when either observation finds the token; (a) only the user's interactive check decides; systemMessage ships only when both favour it, else log record only ← 2/2: r1:I2, r2:I1
- [I2] applied — §9.1: "clears the variable" for the behavioural test named no mechanism, and a shell unset does not remove a settings.json value → each claude run passes --settings with an empty value; env-key precedence labelled not verified, checked by probe 1 ← 2/2: r1:I4, r2:I3
- [I3] applied — §6.4, §7.3, §9.1: "existing tests are the check" was false (substring log check; no repeated unknown name case) → two pin cases added; §7.3 wording corrected ← 2/2: r1:M1, r2:I4
- [I4] applied — §9.2: a scratch HOME leaves headless Claude Code logged out, so neither probe could observe anything → real HOME kept, records selected by session_id from the stream-json init event, user's own value overridden with --settings — reviewer probe accepted: `HOME=$(mktemp -d) claude -p` printed "Not logged in", exit 1 ← 1/2: r1:I1
- [I5] applied — §6.2, §9.1, §11: the overlap rule does not hold for patterns; `cat ~/.ssh/id_*` passes with ssh-private-key off — controller verified in-process (pattern passes, literal ~/.ssh/id_rsa refused as ssh-private-key-2) → rule limited to literal paths and values, limit documented and pinned by a case; adding id_* samples rejected (new refusals for every user) ← 1/2: r1:I3
- [I6] applied — §9.2: the token is lower-cased by the hook, so an upper-case token (macOS uuidgen) is missed → lower-case letters and digits only, case-insensitive searches ← 1/2: r2:I2
- [M1] applied — §7.2: whether unreadable-command refusals carry the report was unclear → they carry none (produced before any rule runs) ← 2/2: r1:M2, r2:M1
- [M2] applied — §9.2: probe 1 left outcomes without an action and claimed a settings-file conclusion from a --settings run → outcome table with an action per row; conclusion limited to --settings ← 2/2: r1:M3, r2:M2
- [M3] applied — §1, §9.1, §11: external claims without a citation → hooks page quote for §1, settings-reference env row for §9.1, permission-modes table for §11, the rest labelled not verified or inference ← 2/2: r1:M4, r2:M4
- [M4] applied — §3, §7.1, §8, §11: undefined terms (prior-art trigger predicate, shared reader, classifier, failure-mode check) → each defined at first use ← 1/2: r1:M5
- [M5] applied — §9.1: the content-pattern case ignored overlaps and the hidden-name check had no location → values matching exactly one pattern on src/config.js; check made inside the helper and in every in-process test file ← 1/2: r1:M6
- [M6] applied — §8: requirements (1) and (2) cannot be provoked by a test → marked as code-review checks ← 1/2: r2:M3
- [M7] applied — §7.2, §10: citations covered only part of the claim → full systemMessage table row quoted with page; "not to the user" and "only place" cut to what the hooks page says ← 1/2: r2:M5

## Round 3 — Feasibility & architecture risk — claude-opus-5-5
**Reviewers:** M=2, usable 2/2
**Reviewer verdicts:** r1: 0 Critical, 1 Important, 4 Minor | r2: 0 Critical, 3 Important, 2 Minor
**Sources mapped:** 10/10
**Reviewer verdict:** 0 Critical, 3 Important, 4 Minor
**Converged:** no

### Dispositions
- [I1] applied — §9.2 probe 2 (b): the transcript stores user-only system records and raw hook output, so a transcript hit could block the systemMessage forever → a hit counts only in message.content of user/assistant records or a non-hook_success attachment; the report lists record types — reviewer observation accepted: system "informational" records and hook_success stdout seen in existing transcripts ← 2/2: r1:I1, r2:I2
- [I2] applied — §9.1, §9.2: "probe 1 checks" the --settings precedence over a user value, but no probe run sets a lower-level value → behavioural test and both probes reuse check_no_superpowers_defaults_setting (tests/claude-code/test-helpers.sh:348, verified) to stop when any settings file sets the variable; the precedence claim removed ← 2/2: r1:M1, r2:I1
- [I3] applied — §7.1, §9.1: the name holds SECRETS, so echo-secret-var refuses `echo $SUPERPOWERS_SECRETS_RULES_OFF` and names it (controller verified in-process: echo and printenv refused, ${...:+set} passes) → name kept (the user chose it), rule restated as "unless the refused command names it", hidden-name check narrowed, one case pins the exception ← 1/2: r2:I3
- [M1] applied — §9.2, §10: log files are named by the UTC date (hook-io.js:31) → probe reads every log file filtered by session_id; guide entry says UTC date ← 2/2: r1:M3, r2:M1
- [M2] applied — §11: project-settings trust was marked unverified but the settings page documents it → sentence cited ← 1/2: r1:M2
- [M3] applied — §9.2 probe 1: table rows overlapped when a run holds both a record and the marker → a record always counts as "record"; the hook-did-not-run row reads "marker, no record" ← 1/2: r1:M4
- [M4] rejected: harness probe not runnable here — in one interactive session with an unknown random token in the variable, have a dispatched subagent run `cat .env`; the user reports whether the message appears on the screen — (would break a constraint) — §7.2: systemMessage visibility for a subagent's call is untested ← 1/2: r2:M2

## Round 4 — Adversarial failure modes — claude-opus-5-5
**Reviewers:** M=2, usable 2/2
**Reviewer verdicts:** r1: 0 Critical, 2 Important, 5 Minor | r2: 0 Critical, 1 Important, 3 Minor
**Sources mapped:** 11/11
**Reviewer verdict:** 0 Critical, 3 Important, 7 Minor
**Converged:** no

### Dispositions
- [I1] applied — §10, §11, §9.1: env-file also opens every .env.<suffix> (.env.local, .env.production) and a hardcoded-* name is off for every file, and the README would not say so → README and guide state each name's reach; limit added with a pointer to the allow-list non-goal; a case pins .env.local passing ← 2/2: r1:I1, r2:M3
- [I2] applied — §7.1, §10, §11: the bracketed rule name leads a model to the README and the switch; nothing tells it not to set the variable → every refusal ends with "Never change Claude Code settings or hook files to get past this refusal; ask the user."; README and guide carry an instruction to assistants; §11 separates capability from likelihood and names compgen -e and env-dump ← 1/2: r1:I2
- [I3] applied — §9.2 probe 2: only a main-session call was probed, while most calls are made by subagents and the hooks page leaves a subagent call's systemMessage delivery undocumented → probe 2 also covers a subagent call (parent and subagents/ transcripts, interactive check of both); the message ships only when both kinds pass (harness field dropped: citable — hooks page states PreToolUse fires for subagent calls and does not say where systemMessage goes) ← 1/2: r2:I1
- [M1] applied — §9.1: the settings-file guard ignored a shell export and stopped the test for every switch user → shell unset plus --settings with an empty value (settings precedence cited); the stop remains only for managed settings ← 1/2: r1:M1
- [M2] applied — §10: a higher settings level replaces the user's list, it is not merged → README states it ← 1/2: r1:M2
- [M3] applied — §8, §10: a user who copies unreadable-command gets no signal → README states it cannot be switched off and the remedy ← 1/2: r1:M3
- [M4] applied — §9.2 probe 2: a systemMessage delivered with the next turn would be missed by a single-turn run → each kind of call runs a second turn with --resume (harness field dropped: citable — the hooks page leaves PreToolUse systemMessage delivery undocumented; the change extends the probe and does not rely on the claim) ← 1/2: r1:M4
- [M5] applied — §8, §9.1: requirement (2) was left to code review although tests/codex/fixtures/hook-that-throws.js (verified) drives hook-io error paths → fixture test with a throwing extra field added ← 1/2: r1:M5
- [M6] applied — §9.2: probe 1 could blame the wrong cause when the installed copy loads or the model reads the file another way → a valid run needs the branch plugin in the init event and a Bash call of exactly `cat .env` ← 1/2: r2:M1
- [M7] applied — §9.1: extending the shared check would stop two unrelated suites for every switch user → a separate function, only for managed settings; the existing function unchanged ← 1/2: r2:M2

**Host self-review:** spec self-review after round 4 — one stale sentence fixed (§7.2: the README log instruction applies whether or not the systemMessage ships); section cross-references checked against the headings; no placeholders.
