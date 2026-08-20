/**
 * BMAD configuration provider: reads `_bmad/config.toml` and registers BMAD
 * config values as DSH prompt variables so BMAD skills can reference them
 * without running the Python resolve_config script.
 *
 * When `_bmad/` is absent the provider registers nothing — BMAD is not
 * installed in this project, and that is valid empty state.
 *
 * @module @deepseek-ai/dsh-bmad
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadCentralConfig, findProjectRoot } from './merge.ts'

/** Cordis plugin name. */
export const name = 'bmad-config'

/** Requires the system-prompt registry to register variables. */
export const inject = ['systemPrompt']

/** Composition configuration for the BMAD config provider. */
export interface Config {
  /**
   * Project root containing `_bmad/`. Defaults to the nearest `.git` or `_bmad`
   * ancestor of the process cwd.
   */
  projectRoot?: string
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  projectRoot: z.string(),
})

/** Prompt variables registered from BMAD's central config. */
const BMAD_VARIABLE_MAP = [
  ['bmad_user_name', ['core', 'user_name']],
  ['bmad_project_name', ['core', 'project_name']],
  ['bmad_communication_language', ['core', 'communication_language']],
  ['bmad_document_output_language', ['core', 'document_output_language']],
  ['bmad_output_folder', ['core', 'output_folder']],
  ['bmad_user_skill_level', ['modules', 'bmm', 'user_skill_level']],
  ['bmad_planning_artifacts', ['modules', 'bmm', 'planning_artifacts']],
  ['bmad_implementation_artifacts', ['modules', 'bmm', 'implementation_artifacts']],
  ['bmad_project_knowledge', ['modules', 'bmm', 'project_knowledge']],
] as const

/** Resolve a nested key path from a TOML object, returning undefined when absent. */
function resolvePath(data: Record<string, unknown>, path: readonly string[]): string | undefined {
  let current: unknown = data
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

/**
 * Register BMAD config values as DSH prompt variables.
 *
 * Reads `_bmad/config.toml` (four-layer merge) once at activation and
 * registers each mapped value as a prompt variable. Absent values register
 * as `undefined`, which DSH's strict interpolation rejects at render — so
 * skills that reference a missing variable fail loud rather than silently
 * substituting an empty string.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const projectRoot = config.projectRoot
    ? resolve(config.projectRoot)
    : findProjectRoot(process.cwd()) ?? process.cwd()

  const bmadDir = join(projectRoot, '_bmad')
  if (!existsSync(bmadDir)) return

  const merged = await loadCentralConfig(projectRoot)

  for (const [varName, path] of BMAD_VARIABLE_MAP) {
    const value = resolvePath(merged, path)
    ctx.systemPrompt.variable(varName, () => value)
  }
}
