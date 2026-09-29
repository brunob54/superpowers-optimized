# Open decisions — dashboard

## Ruling 1 — 2026-09-30 — phase 3 — [task 1/1] Skill tool for the two artifact skills

- **Class:** forced
- **Item:** [task 1/1] n/a n/a — pre-flight conflict: Tasks 1, 7 and 8 must load `artifact-design` and `artifact-capabilities` with the Skill tool, but the run forbids the Skill tool to the controller and every worker
- **Contract clause:** "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Task 1
- **Defensible answers:** n/a
- **Forks:** none; contradiction: none
- **Resolution:** plan governs: "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — Spec section 6 requires the implementer to load these skills, the Artifact tool itself requires both before any artifact page or runtime code is written, and neither skill belongs to the superpowers-orchestrator plugin that the no-Skill-tool rule keeps out, so reading the bundled `.d.ts` files or having the orchestrator load the skills would produce page code written without the platform's required guidance.
