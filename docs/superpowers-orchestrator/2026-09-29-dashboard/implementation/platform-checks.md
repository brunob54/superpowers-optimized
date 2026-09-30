# Platform checks — dashboard (spec section 13)

Checked on 2026-09-30 by Task 1 of the plan. Probe page: https://claude.ai/artifact/P2iqBGEqbpPiJrjoJgTYwW (private; the owner may delete it).

Runtime contract of the probe page and of the loaded `artifact-capabilities` skill: 0.2.66.

| # | Check | Method | Result | Verdict |
|---|---|---|---|---|
| 1 | `${CLAUDE_PLUGIN_DATA}` is substituted in skill text | `claude -p --plugin-dir` probe skill | the slash command `/dataprobe:probe` printed `DATA=[/Users/bruno/.claude/plugins/data/dataprobe-inline]`: not empty, no `${` | confirmed; installed plugin: owed to manual acceptance |
| 2 | `db` access rules can restrict writes to the owner | artifact-capabilities skill text; probe page | yes: the rule `{"path":"proposals","read":"view","write":"owner"}` in `capabilities.db.rules`. The publish stored it ("access rules proposals read view write owner"); an ArtifactData `update` of `proposals/p2` with `as_level: "admin"` was refused (`invalid_argument`, "no such ... document (or no access)") | confirmed |
| 3 | shared-level path of `proposals`; `data/users/<id>/` private | skill text; ArtifactData tool description | the top-level collection `proposals` (collection path `proposals`, document path `proposals/<id>`), outside `data/users/`; ArtifactData `collection: "proposals"` reached it in Step 6. `data/users/<id>/` is private to its viewer, "including from the artifact's owner" (db.d.ts), and ArtifactData states "each viewer's subtree under it is private to that viewer" | confirmed |
| 4 | ArtifactData queries `proposals` with a filter on `state`, also from a later session | Step 6 query; `claude -p` query | this session: the query `where state in [pending, applying]` returned only `p1` (not `p2`, state `applied`). Later session: not run, `claude -p` has no Artifact tool (item 8) | confirmed; later session: owed to manual acceptance |
| 5 | `user.isOwner()` exists under this name | skill text; probe page | exists as `isOwner(): Promise<boolean>` of the `user` namespace, reached by `const user = await claude.use("user")`; there is no `window.claude.user` member (only `claude.use`). No declaration is needed for it. Live value: not stored by the page (see the note under the table) | confirmed |
| 6 | page fetches its `files` file; read returns only `index.html`; a listing is enough in a new session | Steps 5 and 7 | read: returned only the page source (`index.html`, "This version has 2 published files"); the JSON text of `probe-data.json` is not in it (the marker string occurs only inside the page's own comparison code). Listing: `index.html` 3937 bytes and `probe-data.json` 33 bytes, no file content. Page fetch: not observed (see the note under the table). New session: not run, no Artifact tool in `claude -p` | confirmed; page fetch: owed to manual acceptance; new session: owed to manual acceptance |
| 7 | public link shows the latest republish; Share control turns it off; republish of a shared page asks | needs the owner | not checked | owed to manual acceptance |
| 8 | `claude -p` has the Artifact tool | Step 1 | no (`artifact-in-p: no`) | confirmed |
| 9 | `out_dir` files carry each document's version | Step 6 | no field: the file `query/proposals/p1.json` holds only the document body `{"state": "pending"}`, with no `version` and no `id`. The version appears only in the tool's result text (`"p1"  25 bytes  version 1  "<path>"`); a `query` without `out_dir` returns `{"id","data","version","updatedAt"}` per document inline. A stale `if_version` update was refused (`version_mismatch`) | contradicted |
| 10 | `_Completed — ` and `## STOPPED` are the markers | Step 3 | 14 logs; 11 earlier logs `completed=1`; `researching-prior-art` and `autonomous-in-run-decisions` `completed=0`; this run's own log `completed=0 stopped=0`; 9 logs `stopped=` above 0 | confirmed |
| 11 | size of `dashboard-data.json` for this repository | measured in Task 15 | — | owed to Task 15 |
| 12 | page writes can be pinned to a version; a new document can be written only when absent | skill text; probe page | not available — fallback of Task 8/12: `set(data)` and `update(data)` take no version option and a page `DocumentSnapshot` carries no version (`id`, `exists`, `data()`, `metadata`); db.d.ts states "There is no create-if-absent write" | confirmed |

Note on the live page result (items 5, 6 and 12). The probe page writes the
document `probe/result` when a person loads it. `action: "open"` was called,
and ArtifactData `get` of `probe/result` was run three times (right after
`open`, and twice while this file was drafted): each time "No document
"result" in collection "probe"". The page was not loaded by a person during
the task, so the live values `owner`, `fetchOk` and `snapshotKeys` are owed to
manual acceptance; the verdicts of items 5 and 12 come from the skill text.

Step 3 marker lines copied from real logs (Tasks 2 and 4 use these shapes in
their fixtures):

    ## STOPPED — 2026-08-22 — phase 4 — code review ended with 9 user-decision findings (unresolved 0); every one is plan-mandated, so fixing it means changing the plan or spec text, which the review loop must not do on its own
    ## STOPPED — 2026-08-28 — phase 3 — batch 1 BLOCKED task=1: pre-flight plan conflicts (M ≥ 2 log examples at Task 2 Step 5 and Task 3 Step 7 cite an unusable and a zero-finding reviewer as finding sources; Task 3 carried-finding annotation rule contradicts its own example)
    _Completed — 2026-08-27 — HEAD 413c414_

Step 3 counts per log: `researching-prior-art` 0/3, `artifact-layout` 1/7,
`reviewers-per-lens` 1/3, `reviewer-harness-claims` 1/4,
`plan-contracts-not-bodies` 1/4, `autonomous-in-run-decisions` 0/3,
`prompt-pointer-dispatch` 1/3, `marker-position-tolerance` 1/1,
`orchestrator-prompt-pointer` 1/0, `review-gate-m-question` 1/0,
`superpowers-defaults-block` 1/0, `execution-readiness-pass` 1/1,
`worklog` 1/0, `dashboard` 0/0 (completed/stopped).

## Runtime record

- Owner check: `const user = await claude.use("user"); const isOwner = user ? await user.isOwner() : false;` (the skill's short form: `user?.isOwner() ?? false`; `isOwner()` never rejects)
- Read all documents of `proposals` with versions: page side: `const db = await claude.use("db"); const snap = await db.collection("proposals").get();` then `snap.docs` (each `id`, `exists`, `data()`, `metadata`) — the page sees no version. Claude side: ArtifactData `query` (or `list`) with `collection: "proposals"`; without `out_dir` each document comes back as `{"id","data","version","updatedAt"}`; with `out_dir` the version is only in the result line of each file (`"<id>"  <n> bytes  version <v>  "<path>"`)
- Write one document pinned to a version: page side: not available: re-read just before each write (`db.collection("proposals").doc(id).get()`, then `.set(body)` or `.update(fields)`). Claude side: ArtifactData `set`/`update`/`delete` with `if_version: <v>`, or a `batch` entry with `if_version`; a stale version is refused with `version_mismatch` ("nothing was written"), observed in Step 6
- Write a new document only when it does not exist yet: page side: not available ("There is no create-if-absent write"; the skill's substitute is a lease: `doc.acquire({holder, ttlMs})`, then `get()`, then `set()` only when absent, which coordinates only callers that all use `acquire`). Claude side: ArtifactData `set` with no `if_version` creates a document and is refused on an existing one (`version_mismatch`: "already exists and this write carried no if_version"), observed on `proposals/p2`
- Owner-only write rule for `proposals` (item 2): `{"path":"proposals","read":"view","write":"owner"}` in `capabilities.db.rules`; declared in the `capabilities` object, stored by the publish, and enforced (an `as_level: "admin"` update was refused)
- Capabilities of the private page's first publish: `{"db":{"rules":[{"path":"proposals","read":"view","write":"owner"}]},"user":{}}`
- Probe page URL: https://claude.ai/artifact/P2iqBGEqbpPiJrjoJgTYwW (private; the owner may delete it)
- One ArtifactData `out_dir` file (item 9): the document body only; no field holds the version (see row 9)

      { "state": string }
