_Researched: 2026-09-29 | registry: service | canonical name: claude.ai Artifact as an HTML snapshot republished on each refresh | versions inspected: n/a_

# claude.ai Artifact as an HTML snapshot (no runtime capability)

Hosted service; no version anchor. Source for every item unless stated:
https://code.claude.com/docs/en/artifacts (read 2026-09-29).

## Findings

- Update: "Claude edits the underlying file and publishes again to the
  same URL." "Each publish becomes a version".
- A later session needs the URL: "Without either, a new session creates a
  new artifact instead of updating one." `/artifacts` (v2.1.208 or later)
  lists owned artifacts.
- Only the session's Artifact tool publishes; a script cannot. The first
  publish goes through the permission mode; later republishes run without
  asking unless a capability is added or the page was shared.
- Without a capability, the page holds the data of its last publish.
- Edits back to a session without a capability: comments (Team or
  Enterprise, shared within the organization, v2.1.221 or later; not on a
  public page), or a copy-and-paste export: "Ask for an export control that
  produces text you can paste into the terminal". The viewer "blocks any
  download the page starts itself, including links to `data:` or `blob:`
  URLs".
- Page limits: one page, 16 MiB rendered, network only to own origin and
  Google Fonts, scripts from five CDN hosts, no relative links.
- Same publishing gates and sharing rules as the `db` candidate (claude.ai
  login, Anthropic API only, Pro/Max public link only, Team/Enterprise
  organization sharing).
- The legacy claude.ai chat artifact
  (https://support.claude.com/en/articles/9547008-publish-and-share-artifacts)
  behaves differently: "You can't publish an artifact again after you
  unpublish it."
- Prior art: official plugin "project-artifact" publishes a tabbed project
  status artifact and republishes on refresh, with no write-back
  (https://claudecowork.im/resources/official/project-artifact, third-party
  listing).
