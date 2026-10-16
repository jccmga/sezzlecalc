---
description: Run the PRD -> clarify -> plan -> plan review pipeline and stop before implementation
agent: planning-orchestrator
---
Take this feature request through the planning pipeline only — PRD, clarification, plan, and plan review — and stop after REVIEW with an approved plan:

$ARGUMENTS

Delegate each step to the owning subagent (`@prd-parser`, `@planner`, `@plan-reviewer`) and gate every hand-off on the previous step succeeding. Do not implement or verify; finish by surfacing the PRD and plan file paths. If no request was provided, ask the user what they want to build.
