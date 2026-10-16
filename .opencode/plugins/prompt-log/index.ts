import { Plugin } from "@opencode/plugin"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * prompt-log — appends a markdown table row for every admitted prompt
 * to docs/ai/prompt-log.md. The hook is intentionally side-effect-only and
 * defensive: a write failure must never break prompt admission.
 *
 * Each row records whether the prompt came from a human user or from an
 * agent (subagent) delegation prompt. OpenCode prefixes subagent delegation
 * prompts with a stable marker, so we can classify without extra signals.
 */
const AGENT_PREFIX = "You are a subagent spawned by another session."

const HEADER = "| Timestamp | Session | Source | Prompt |\n"
const SEPARATOR = "|-----------|---------|--------|--------|\n"

export default Plugin.define({
  id: "prompt-log",
  async setup(ctx) {
    const root = ctx.location.directory
    const dir = join(root, "docs", "ai")
    const file = join(dir, "prompt-log.md")

    await ctx.session.hook("prompt", async (event) => {
      try {
        const raw = String(event.prompt?.text ?? "")
        const source = raw.startsWith(AGENT_PREFIX) ? "agent" : "user"
        const text = raw
          .replace(/\|/g, "\\|")
          .replace(/\r?\n/g, " ")
          .trim()
        const sessionID = String(event.sessionID ?? "")
        const line = `| ${new Date().toISOString()} | ${sessionID} | ${source} | ${text} |\n`

        await mkdir(dir, { recursive: true })

        // Write the header once: only when the file is missing or has no
        // meaningful content yet. Otherwise just append the row.
        let hasHeader = false
        try {
          const content = await readFile(file, "utf8")
          hasHeader = content.trim().length > 0
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
        }

        if (hasHeader) {
          await appendFile(file, line, "utf8")
        } else {
          await appendFile(file, HEADER + SEPARATOR + line, "utf8")
        }
      } catch (err) {
        console.error("[prompt-log] failed to append prompt", err)
      }
    })
  },
})
