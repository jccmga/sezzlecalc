import { Plugin } from "@opencode/plugin"

const MAX_TIMEOUT_MS = 120_000

/**
 * Patterns that describe destructive or dangerous shell commands.
 * Each resource string (the shell command being matched against permission
 * rules) is tested against every pattern; a match denies the action.
 *
 * Note: plain `git push` is intentionally NOT matched — only force-push
 * (`--force` / `-f`) is blocked, since opencode.json already handles push.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // rm -rf / rm -fr (recursive + force, in either flag order)
  /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\b/i,
  // sudo
  /\bsudo\b/,
  // git push --force / git push -f (but never plain `git push`)
  /\bgit\s+push\b[^\n]*(?:--force|-f)\b/i,
  // curl ... | sh / bash
  /\bcurl\b[^\n]*\|\s*(?:sh|bash)\b/i,
  // mkfs (and mkfs.<fstype>)
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  // fork bomb
  /:\(\)\s*\{\s*:\s*\|:\s*&\s*\}\s*;?\s*:/,
  // redirect overwriting a block device
  />\s*\/dev\/sd[a-z]/i,
]

export default Plugin.define({
  id: "guardrails",
  async setup(ctx) {
    // (a) Deny dangerous shell commands after configured rules are evaluated.
    await ctx.permission.hook("evaluate", (event) => {
      try {
        if (event.action !== "shell") return
        const resources = Array.isArray(event.resources) ? event.resources : []
        const blocked = resources.some((r) =>
          DANGEROUS_PATTERNS.some((re) => re.test(String(r))),
        )
        if (!blocked) return
        event.effect = "deny"
        event.message = "blocked by guardrails"
      } catch {
        // never break permission evaluation
      }
    })

    // (b) Clamp shell timeout and tag the environment before execution.
    await ctx.shell.hook("create.before", (event) => {
      try {
        if (typeof event.timeout === "number" && Number.isFinite(event.timeout)) {
          event.timeout = Math.min(event.timeout, MAX_TIMEOUT_MS)
        }
        if (event.env && typeof event.env === "object") {
          event.env.OPENCODE_GUARDRAILS = "1"
        }
      } catch {
        // never break shell execution
      }
    })
  },
})
