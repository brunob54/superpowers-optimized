# Manual acceptance — dashboard

The owner runs these checks before the merge, with the installed plugin, in an
interactive Claude Code session logged in to claude.ai. Write the result of
each check in its last column.

## Measured page data (spec section 13 item 11)

- Extractor JSON of this repository (private): 62892 bytes.
- `dashboard-data.json`: 62892 bytes; one Read call returned it whole (1826 lines, no PARTIAL notice).

## Steps

| # | Step | Expected | Result |
|---|---|---|---|
| 0 | Reinstall the plugin from this branch (the running copy under `~/.claude/plugins/cache/superpowers-orchestrator/` changes only on reinstall) | `/superpowers-orchestrator:dashboard` is listed | Pass (2026-10-01): plugin 7.56.0 installed from this branch at `6eb0153`; the skill is listed |
| 1 | `/superpowers-orchestrator:dashboard refresh` | Asks before it creates the page; publishes; the reply says "first refresh" and names the data size and the URL | Pass: asked before it created the page; the reply said "first refresh", 63894 bytes, and the URL |
| 2 | Open the page | Two tabs, "Waits for me" first; the banner "Private page — do not make it public"; lock signs on items of untracked files; the "as of" line names the commit and the branch | Pass: seen by the owner. Remark: the line `not-found: docs/worklogs not found` read like an error; reworded in `b0ac210` |
| 3 | On the page, mark one open item of `session-log.md` resolved (or change the note of a work-log part) | The item shows "pending sync" | Pass: the owner clicked "Mark resolved" on "Batch 1 (tasks 1-3) running"; the item showed "pending sync" |
| 4 | `/superpowers-orchestrator:dashboard sync` | Shows one diff; after the accept, the line in the file ends with ` [resolved <date>: from the dashboard]`; the report lists the changed file | Pass: one diff; line 4607 of `session-log.md` ends with ` [resolved 2026-10-01: from the dashboard]`; the report listed `changed session-log.md (untracked)` |
| 5 | `/superpowers-orchestrator:dashboard refresh` again | The change summary counts the item; the item is gone from the open items | Pass: `sessionOpenItems: 0 added, 1 removed`; the item is gone (63346 bytes) |

## Checks owed by platform-checks.md

The numbers in the first column are the rows of `platform-checks.md`. The last
three rows are live values of the probe page that the note under that table
says are owed to manual acceptance.

| # | Check | What to observe | Result |
|---|---|---|---|
| 1 | `${CLAUDE_PLUGIN_DATA}` is substituted in skill text, for the installed plugin | After step 0, run the `--state-dir` command of the `refresh` precondition step 3 (the state command of `skills/dashboard/SKILL.md`) and read its output, the folder where the page URL is kept: the path is not empty and holds no `${` | Pass: the command printed a path under the plugin data folder, with no `${` |
| 4 | The page's proposals can be queried with a filter on `state` from a later session | In a new session, ask Claude to list the proposals of the page with state `pending` or `applying` (this happens in step 4): only the pending edit is listed, not an applied one | Pass in the session of the acceptance only: before the sync the query listed the one pending proposal; after it, the query listed nothing (the proposal was `applied`). Not run in a new session |
| 6 | The page fetches its `files` file (page fetch) | Load the private page as the owner: the data shown on the page comes from `dashboard-data.json` (the "as of" line and the items are filled, no load error) | Pass: the "as of" line and the items were filled; no load error |
| 6 | A listing is enough in a new session (new session) | In a new session, `refresh` or `sync` lists the published files of the page and does not need the file text: it names `index.html` and `dashboard-data.json` with their sizes | Not run: it needs a new session |
| 7 | The public link shows the latest republish; the Share control turns it off; a republish of a shared page asks | Use the public page only if you choose to share it: open its link after a second `refresh` and check it shows the new "as of" line; turn the Share control off and check the link stops working; run `refresh` on a shared page and check that it asks before it publishes | Not run: the owner did not share the page |
| 5 | Live value `owner`: `user.isOwner()` returns true for the owner | Load the private page as the owner: the edit controls (resolve, note) appear. They appear only when `isOwner()` returned true | Pass: the note field and the "Mark resolved" button appeared |
| 6 | Live value `fetchOk`: the page could fetch its data file | Load the private page as the owner: the items appear and no error banner shows. If the page cannot fetch its file, it shows an error instead of items | Pass: the items appeared; no error banner |
| 12 | Live value `snapshotKeys`: the fields a page `DocumentSnapshot` of the database gives | After one edit on the page (step 3), the edit is listed as proposal in `sync` (step 4). This shows the page could write and read its proposal documents; a snapshot carries `id`, `exists`, `data()` and `metadata`, and no version | Pass: `sync` listed the page edit as one proposal (version 1) |

## Acceptance run of 2026-10-01

The run used the plugin installed from `6eb0153`, on `main` at `164de1d`. The
private page is https://claude.ai/artifact/EDgopP3v6jrebKpoQMCmUX.

- The Claude in Chrome extension could load and read the page, but its clicks
  did not reach the page (an Artifact page runs in a frame of another origin).
  The owner made the click of step 3 in their own browser.
- In the second `refresh`, `dashboard-data.json` was not read whole with the
  Read tool. It was compared with the version read whole in the first
  `refresh`: only the build time and the removed item differed.
- The line `- Batch 1 (tasks 1-3) running` exists three times in
  `session-log.md` (lines 1976, 4593, 4607). `sync` changed only line 4607,
  the line of the entry that the page named.
- Eight commits followed this run (`1a36d10` to `570f8b3`). They change the
  repository name on the shared page, the page text of a missing source, and
  documents. The dashboard test suite and four reviews checked them; the
  manual steps above were not run a second time on them.
