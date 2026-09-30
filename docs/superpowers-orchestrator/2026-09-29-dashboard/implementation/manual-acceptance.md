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
| 0 | Reinstall the plugin from this branch (the running copy under `~/.claude/plugins/cache/superpowers-orchestrator/` changes only on reinstall) | `/superpowers-orchestrator:dashboard` is listed | |
| 1 | `/superpowers-orchestrator:dashboard refresh` | Asks before it creates the page; publishes; the reply says "first refresh" and names the data size and the URL | |
| 2 | Open the page | Two tabs, "Waits for me" first; the banner "Private page — do not make it public"; lock signs on items of untracked files; the "as of" line names the commit and the branch | |
| 3 | On the page, mark one open item of `session-log.md` resolved (or change the note of a work-log part) | The item shows "pending sync" | |
| 4 | `/superpowers-orchestrator:dashboard sync` | Shows one diff; after the accept, the line in the file ends with ` [resolved <date>: from the dashboard]`; the report lists the changed file | |
| 5 | `/superpowers-orchestrator:dashboard refresh` again | The change summary counts the item; the item is gone from the open items | |

## Checks owed by platform-checks.md

The numbers in the first column are the rows of `platform-checks.md`. The last
three rows are live values of the probe page that the note under that table
says are owed to manual acceptance.

| # | Check | What to observe | Result |
|---|---|---|---|
| 1 | `${CLAUDE_PLUGIN_DATA}` is substituted in skill text, for the installed plugin | After step 0, run `/superpowers-orchestrator:dashboard` and read where it says it keeps the page URL: the path is not empty and holds no `${` | |
| 4 | The page's proposals can be queried with a filter on `state` from a later session | In a new session, ask Claude to list the proposals of the page with state `pending` or `applying` (this happens in step 4): only the pending edit is listed, not an applied one | |
| 6 | The page fetches its `files` file (page fetch) | Load the private page as the owner: the data shown on the page comes from `dashboard-data.json` (the "as of" line and the items are filled, no load error) | |
| 6 | A listing is enough in a new session (new session) | In a new session, `refresh` or `sync` lists the published files of the page and does not need the file text: it names `index.html` and `dashboard-data.json` with their sizes | |
| 7 | The public link shows the latest republish; the Share control turns it off; a republish of a shared page asks | Use the public page only if you choose to share it: open its link after a second `refresh` and check it shows the new "as of" line; turn the Share control off and check the link stops working; run `refresh` on a shared page and check that it asks before it publishes | |
| 5 | Live value `owner`: `user.isOwner()` returns true for the owner | Load the private page as the owner: the edit controls (resolve, note) appear. They appear only when `isOwner()` returned true | |
| 6 | Live value `fetchOk`: the page could fetch its data file | Load the private page as the owner: the items appear and no error banner shows. If the page cannot fetch its file, it shows an error instead of items | |
| 12 | Live value `snapshotKeys`: the fields a page `DocumentSnapshot` of the database gives | After one edit on the page (step 3), the edit is listed as proposal in `sync` (step 4). This shows the page could write and read its proposal documents; a snapshot carries `id`, `exists`, `data()` and `metadata`, and no version | |
