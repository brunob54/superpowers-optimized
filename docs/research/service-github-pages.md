_Researched: 2026-09-29 | registry: service | canonical name: GitHub Pages | versions inspected: n/a_

# GitHub Pages

Hosted service; no version anchor. docs.github.com Pages pages read
2026-09-29.

## Findings

- "GitHub Pages sites are publicly available on the internet, even if the
  repository for the site is private (if your plan or organization allows
  it)." (creating-a-github-pages-site)
- "To publish a GitHub Pages site privately, your organization must use
  GitHub Enterprise Cloud." Access control only for project sites of
  organization-owned private or internal repositories; "A privately
  published site can only be accessed by people with read access to the
  repository the site is published from."
  (https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- Site count: one user or organization site per account; project sites
  "Maximum of one pages site per repository"
  (https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages).
- "the visitor's IP address is logged and stored for security purposes,
  regardless of whether the visitor has signed into GitHub or not" (same
  page).
- Static hosting only; no write path from the page without a token in the
  browser or a separate backend.
- Limits: site at most 1 GB; soft 100 GB per month bandwidth; soft 10
  builds per hour without a custom Actions workflow
  (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
- Needs a GitHub remote and push rights. npm `gh-pages` 6.3.0 needs
  `"node": ">=10"` (https://registry.npmjs.org/gh-pages/latest).
- No uptime SLA except Enterprise Cloud
  (https://github.com/customer-terms/github-online-services-sla). Lock-in
  low: content stays in git.

## Gaps

Free/Pro/Team Pages split not checked on a primary GitHub page; GitHub
Enterprise Cloud pricing not checked.
