---
description: Run the full PRD -> plan -> review -> implement -> verify pipeline
agent: orchestrator
---
Take this feature request through the full delivery pipeline (PRD, plan, plan review, implementation, then verification):

$ARGUMENTS

Delegate each step to the owning subagent (`@prd-parser`, `@planner`, `@plan-reviewer`, `@coder`, `@qa-lead`, `@docs-writer`) and gate every hand-off on the previous step succeeding. If no request was provided, ask the user what they want to build.
