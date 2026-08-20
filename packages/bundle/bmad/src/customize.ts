/**
 * Model-facing `bmad_resolve_customize` tool: natively resolves a BMAD skill's
 * layered `customize.toml` without requiring Python or uv. Replaces the
 * `uv run resolve_customization.py` command that BMAD skills instruct the
 * model to run on activation.
 *
 * @module @deepseek-ai/dsh-bmad/customize
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadCustomization, findProjectRoot, extractKey } from './merge.ts'

/** Cordis plugin name. */
export const name = 'bmad-customize'

/** Requires the tool registry to register the model-facing tool. */
export const inject = ['tools']

/** Composition configuration for the customize resolver. */
export interface Config {
  /**
   * Project root containing `_bmad/`. Defaults to the nearest `.git` or `_bmad`
   * ancestor of the calling agent's session cwd.
   */
  projectRoot?: string
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  projectRoot: z.string(),
})

/**
 * Register the `bmad_resolve_customize` tool on `ctx.tools`.
 * @param ctx - Cordis context with the tools registry.
 * @param config - composition configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const configuredRoot = config.projectRoot ? resolve(config.projectRoot) : undefined

  ctx.tools.register(defineTool({
    name: 'bmad_resolve_customize',
    description:
      'Resolve a BMAD skill\'s layered customize.toml configuration (defaults → team → user) into a JSON object. '
      + 'Use this instead of `uv run resolve_customization.py` when activating BMAD skills. '
      + 'Pass the skill name (e.g., "bmad-agent-pm") and optionally a dotted key path (e.g., "agent.identity") to extract a subset.',
    parameters: {
      skill: {
        type: 'string',
        required: true,
        description: 'The BMAD skill name (e.g., "bmad-agent-pm", "bmad-prd").',
      },
      key: {
        type: 'string',
        description: 'Optional dotted key path to extract (e.g., "agent", "agent.identity", "workflow"). Omit for the full merged object.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolved: { type: 'boolean', required: true },
          data: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.data,
      }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd ?? process.cwd()
      const projectRoot = configuredRoot ?? findProjectRoot(cwd) ?? cwd

      const skillDir = join(cwd, '.agents', 'skills', args.skill)
      if (!existsSync(skillDir)) {
        throw new Error(`BMAD skill directory not found: ${skillDir}. Ensure BMAD is installed in this project (run \`npx bmad-method install\`).`)
      }

      const customizePath = join(skillDir, 'customize.toml')
      if (!existsSync(customizePath)) {
        return Promise.resolve({
          resolved: false,
          data: '{}',
        })
      }

      const merged = await loadCustomization(projectRoot, skillDir)

      let data: unknown = merged
      if (args.key) {
        data = extractKey(merged, args.key) ?? {}
      }

      return {
        resolved: true,
        data: JSON.stringify(data, null, 2),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Resolve BMAD customize: ${args.skill}`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}
