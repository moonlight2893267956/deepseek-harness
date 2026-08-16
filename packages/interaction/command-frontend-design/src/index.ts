/**
 * Human-facing `/frontend-design` command. It loads the `frontend-design` disk
 * skill through the skill registry and renders its guidance back to the user;
 * it does not start a model round. The skill itself lives at
 * `.agents/skills/frontend-design/SKILL.md` and is discovered by the filesystem
 * skill provider, so this plugin is a thin load-and-render shell.
 * @module @deepseek-ai/dsh-command-frontend-design
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { renderSkillContent, type SkillDefinition } from '@deepseek-ai/dsh-skill'

export const name = 'command-frontend-design'
export const inject = ['commands', 'skills'] as const

const SKILL_NAME = 'frontend-design'

/** Validation narrows the skill name and keeps the literal in one place. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

if (!COMMAND_NAME.test(SKILL_NAME)) {
  throw new Error(`command-frontend-design: invalid skill name ${JSON.stringify(SKILL_NAME)}`)
}

/**
 * Load the frontend-design skill and render its guidance for the current
 * request. Returns an error result (no model round) when the skill is absent
 * from the composed skill roots.
 * @param invocation - receiving agent, raw command input, and UI cancellation.
 * @param ctx - plugin context used to read the skill registry.
 * @returns the rendered skill guidance, or an error when the skill is missing.
 */
async function executeFrontendDesignCommand(invocation: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const skill: SkillDefinition | undefined = await ctx.skills.get(SKILL_NAME, {
    signal: invocation.signal,
  })
  if (skill === undefined) {
    return {
      kind: 'error',
      text: `The "${SKILL_NAME}" skill is not available in this workspace. Mount a profile that includes the skill provider and the skill root.`,
    }
  }
  return { kind: 'success', text: renderSkillContent(skill) }
}

/** Register the global `/frontend-design` command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: SKILL_NAME,
    description: 'load the frontend-design skill and render its web design guidance',
    handler: invocation => executeFrontendDesignCommand(invocation, ctx),
  })
}
