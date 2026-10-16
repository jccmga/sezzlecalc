# Skill Library

This repo ships the agent skills the harness relies on, so a reviewer can reproduce the exact agent behavior from a clean checkout.

Skills are discovered by the harness from `.opencode/skills/` (project-local, highest precedence), `.agents/skills/`, and the global agent-skills directory. Vendoring a skill into `.opencode/skills/` pins the exact copy the harness loads and makes it reproducible in the repository.

## Vendored skills

These five third-party skills are committed under `.opencode/skills/` so the harness loads the pinned copies.

| Skill (id) | Location | License / Author | Why it matters here |
| --- | --- | --- | --- |
| `shadcn` | `.opencode/skills/shadcn/` | MIT · © shadcn (`shadcn/ui` — github.com/shadcn/ui) | The frontend is built from shadcn/ui components, so the agent needs the canonical component, registry, and composition rules. |
| `using-git-worktrees` | `.opencode/skills/using-git-worktrees/` | MIT · © 2025 Jesse Vincent (`obra/superpowers`) | Implementation runs in an isolated worktree; this skill detects existing isolation and sets up a clean baseline before edits begin. |
| `verification-before-completion` | `.opencode/skills/verification-before-completion/` | MIT · © 2025 Jesse Vincent (`obra/superpowers`) | Nothing is called "done" without raw command output — successful claims must be backed by fresh verification evidence. |
| `tdd` | `.opencode/skills/tdd/` | MIT · © 2026 Matt Pocock (`mattpocock/skills`) | Drives the Go test suite and the Vitest suites test-first (red → green), keeping tests behavior-focused at agreed seams. |
| `code-review` | `.opencode/skills/code-review/` | MIT · © 2026 Matt Pocock (`mattpocock/skills`) | The final review pass runs this two-axis (Standards + Spec) review against the diff before a change is accepted. |

## Project-local (authored) skills

These live in `.opencode/skills/` and were authored for this repo (following the `skill-creator` approach) rather than vendored from upstream.

- `api-contract` — `.opencode/skills/api-contract/` — the single source of truth for the calculator REST contract (operations, request/response JSON shapes, and error taxonomy) shared by the Go backend and the React frontend so the two layers cannot drift.
- `go-http-service` — `.opencode/skills/go-http-service/` — idiomatic patterns for the Go `net/http` JSON service: layout, sentinel errors mapped to HTTP status codes, a consistent response envelope, and table-driven/`httptest` tests.

## Third-party: `clean-code`

`clean-code` is third-party content, not authored here: **MIT · © wondelai, v1.2.0** (declared in its frontmatter). It currently lives at `.opencode/skills/clean-code/` with its `references/` set (naming, functions, comments/formatting, error handling, code smells, testing principles).

## Other available global skills (not vendored)

The global agent-skills directory also provides the following skills. They remain available to the harness (and to the agent on demand) but are intentionally not copied into the repo, because they fall outside this project's core loop or are situational/meta.

| Skill (id) | Upstream source | Why it was not vendored |
| --- | --- | --- |
| `better-auth-security-best-practices` | better-auth/skills | No auth in this project. |
| `diagnosing-bugs` | mattpocock/skills | Situational; overlaps `systematic-debugging`, used only when a bug appears. |
| `domain-modeling` | mattpocock/skills | No GLOSSARY/ADR workflow in this small repo; meta/situational. |
| `frontend-design` | anthropics/skills | Relevant to React but not core; available globally. |
| `improve-codebase-architecture` | mattpocock/skills | Greenfield, nothing to refactor. |
| `skill-creator` | anthropics/skills | Meta tooling; was used to author the repo-local skills, not part of the build loop. |
| `systematic-debugging` | obra/superpowers | Meta/situational; only needed when debugging. |
| `vercel-react-best-practices` | vercel-labs/agent-skills | Relevant to React but not core; available globally. |
| `web-design-guidelines` | vercel-labs/agent-skills | Relevant to React/UI but not core; available globally. |
| `writing-for-agents` | mattpocock/skills | Meta; used when editing skills or `AGENTS.md`. |

The OpenCode harness also bundles a few meta skills that are not part of this repo and not in the global agent-skills directory: `find-skills` (discover/install skills; upstream vercel-labs/skills), `opencode` (questions about OpenCode itself), and `report` (file an OpenCode issue). They ship with the harness and are available globally.

## Attribution & license

The five vendored skills are third-party content, redistributed here under their respective upstream licenses: `shadcn` under the MIT license of the `shadcn/ui` project; `using-git-worktrees` and `verification-before-completion` under the MIT license of `obra/superpowers` (© 2025 Jesse Vincent); and `tdd` and `code-review` under the MIT license of `mattpocock/skills` (© 2026 Matt Pocock). Each copy was taken verbatim from the global agent-skills directory (`~/.agents/skills/<id>/`), and the original `SKILL.md` frontmatter and any accompanying license headers/`LICENSE` files were preserved unchanged — no files were edited, and only `.DS_Store` artifacts were excluded. Where a skill's own frontmatter declares a `license`/`metadata.author`, that declaration was carried through as-is; for skills whose frontmatter omits it, attribution follows the upstream repository. `clean-code` is likewise third-party (MIT, © wondelai) and is included with its frontmatter intact.
