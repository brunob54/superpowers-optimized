_Researched: 2026-09-29 | registry: service | canonical name: claude.ai Artifact with the db runtime capability | versions inspected: n/a_

# claude.ai Artifact with the `db` runtime capability

Hosted service; no version anchor. Local runtime contract at research time:
0.2.66 (from the installed artifact-capabilities skill; not verified).

## Findings

- Public Claude Code documentation names only "connector calls" and "file
  downloads" as runtime capabilities; it does not name `db`, `ArtifactData`
  or an owner check. Source: https://code.claude.com/docs/en/artifacts
- The capability exists and changes often. Claude Code CHANGELOG
  (https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
  entries: "Fixed artifact republishes silently resetting stored database
  access rules or dropping the viewer profile scope when that capability
  was re-sent without them; they are now refused"; "Improved artifact
  database writes: an update can now remove a single field instead of
  rewriting the whole document".
- Page-side API seen in issue https://github.com/anthropics/claude-code/issues/94426
  (open, 2026-09-15, runtime contract 0.2.49): `capabilities: {db: {}}`,
  `collection(...).get()`, `onSnapshot()`. Reported defect: writes persist,
  but a fresh page load does not reliably show them.
- claude.ai artifact storage: "Storage has a 20 MB limit per artifact and
  accepts text only"; "Whoever builds an artifact decides which data uses
  personal storage and which uses shared"; "Available on Pro, Max, Team,
  and Enterprise plans". Source:
  https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- Publishing gates (all Claude Code artifacts): a claude.ai `/login`
  session only — "Sessions using an API key, gateway token, or
  cloud-provider credential cannot publish"; not on Bedrock, Google Cloud
  Agent Platform or Microsoft Foundry; off by default in Agent SDK, GitHub
  Action and MCP-server contexts; not with CMEK, HIPAA or Zero Data
  Retention. No operating-system or Node gate. Source:
  https://code.claude.com/docs/en/artifacts
- Sharing: private at first; within an organization only on Team and
  Enterprise; "On Pro and Max plans, a public link is the only way to share
  an artifact". Same source.
- Read-back: the documentation says Claude saves a read page's full source
  to a local file; issue https://github.com/anthropics/claude-code/issues/87673
  (closed "not planned" 2026-09-21) reports that a WebFetch read of an
  owned artifact failed. Not tested.
- Risk: no published feature-deprecation commitment
  (https://www.anthropic.com/research/deprecation-commitments covers models
  only); no documented export of stored rows.

## Gaps

No public documentation of `ArtifactData` actions or `user.isOwner()`;
Compliance API schema not read.
