# Probe results — secrets-rules-switch

The probes ran on the branch `feature/secrets-rules-switch` with `--plugin-dir`.

- Date of the runs: 2026-10-09
- Claude Code version: 2.1.295 (Claude Code)
- Probe 1 outcome: pass; the variable reaches the hook through --settings
- Probe 2 main session: valid true; modelCanRead true; logHit true; records that hold the token: attachment:hook_system_message
- Probe 2 subagent: valid true; modelCanRead true; logHit true; records that hold the token: attachment:hook_system_message
- Interactive check (a): not made (an autonomous run cannot make it)
- Decision: SYSTEM_MESSAGE_SHIPS stays false; only the log record ships (decision rule of the spec, section 9.2). To ship the message later, the user makes check (a) and, if the rule holds for both kinds of call, sets the constant to true.
- Subagent hook-scope test: PASSED
