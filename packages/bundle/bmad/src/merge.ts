/**
 * Native TypeScript port of BMAD's `config_utils.py` TOML merge logic.
 *
 * Reads and structurally merges BMAD's layered TOML configuration files
 * (customize.toml, config.toml) without requiring Python or uv. The merge
 * rules mirror the Python implementation exactly: scalars override, tables
 * deep-merge, arrays-of-tables keyed by `code` or `id` replace matching items
 * and append new ones, and all other arrays append.
 *
 * @module @deepseek-ai/dsh-bmad/merge
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { TomlError, parse as parseToml } from 'smol-toml'

/** Fields that identify a keyed array-of-tables entry for replace-or-append. */
const KEYED_MERGE_FIELDS = ['code', 'id'] as const

/** A TOML layer that loaded successfully or was absent (empty). */
type TomlLayer = Record<string, unknown>

/**
 * Read and parse a TOML file. Returns an empty object when the file is absent;
 * throws on parse failure or I/O errors that are not "file not found".
 * @param filePath - absolute path to the TOML file.
 * @returns the parsed TOML table, or `{}` when the file does not exist.
 */
export async function loadToml(filePath: string): Promise<TomlLayer> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return {}
    throw error
  }
  try {
    const parsed = parseToml(content)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as TomlLayer
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`failed to parse ${filePath}: ${error.message}`)
    }
    throw error
  }
}

/**
 * Detect whether all items in a concatenated base+override array carry the
 * same keyed-merge field (`code` or `id`). Returns the field name or `null`.
 * Throws if a keyed field value is not a non-empty string.
 */
function detectKeyedField(items: unknown[]): string | null {
  if (items.length === 0 || !items.every(isPlainObject)) return null
  for (const candidate of KEYED_MERGE_FIELDS) {
    if (items.every(item => candidate in (item as Record<string, unknown>))) {
      for (const item of items) {
        const value = (item as Record<string, unknown>)[candidate]
        if (typeof value !== 'string') {
          throw new Error(`keyed array identifier \`${candidate}\` must be a string, got ${typeof value}`)
        }
        if (value.length === 0) {
          throw new Error(`keyed array identifier \`${candidate}\` must not be empty`)
        }
      }
      return candidate
    }
  }
  return null
}

/** Type guard for a plain TOML table (record, not array or primitive). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge two arrays: keyed arrays-of-tables replace matching items by `code`/`id`
 * and append new ones; all other arrays concatenate.
 * @param base - the lower-priority array.
 * @param override - the higher-priority array.
 * @returns the merged array.
 */
export function mergeArrays(base: unknown[], override: unknown[]): unknown[] {
  const keyedField = detectKeyedField([...base, ...override])
  if (keyedField === null) {
    return [...base, ...override]
  }
  const result: Record<string, unknown>[] = []
  const indexByKey = new Map<string, number>()
  for (const item of base) {
    const copied = { ...(item as Record<string, unknown>) }
    indexByKey.set(copied[keyedField] as string, result.length)
    result.push(copied)
  }
  for (const item of override) {
    const copied = { ...(item as Record<string, unknown>) }
    const key = copied[keyedField] as string
    const existing = indexByKey.get(key)
    if (existing !== undefined) {
      result[existing] = copied
    } else {
      indexByKey.set(key, result.length)
      result.push(copied)
    }
  }
  return result
}

/**
 * Recursively merge two TOML values: tables deep-merge, keyed arrays-of-tables
 * replace matching items, and all other arrays append. Scalars are replaced
 * by the override.
 * @param base - the lower-priority value.
 * @param override - the higher-priority value.
 * @returns the merged value.
 */
export function structuralMerge(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      result[key] = key in result ? structuralMerge(result[key], value) : value
    }
    return result
  }
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override)
  }
  return override
}

/**
 * Merge multiple TOML layers in priority order (lowest first).
 * @param layers - TOML tables from lowest to highest priority.
 * @returns the merged table.
 */
export function mergeLayers(layers: TomlLayer[]): TomlLayer {
  let merged: TomlLayer = {}
  for (const layer of layers) {
    merged = structuralMerge(merged, layer) as TomlLayer
  }
  return merged
}

/**
 * Load and merge a BMAD skill's three-layer customization TOML.
 *
 * Layer order (lowest to highest priority):
 * 1. `{skillDir}/customize.toml` — defaults shipped with the skill
 * 2. `{projectRoot}/_bmad/custom/{skillName}.toml` — team overrides
 * 3. `{projectRoot}/_bmad/custom/{skillName}.user.toml` — personal overrides
 *
 * @param projectRoot - absolute path to the project root containing `_bmad/`.
 * @param skillDir - absolute path to the skill directory (where `customize.toml` lives).
 * @returns the merged customization table.
 */
export async function loadCustomization(projectRoot: string, skillDir: string): Promise<TomlLayer> {
  const skillName = basename(skillDir)
  const customDir = join(projectRoot, '_bmad', 'custom')
  return mergeLayers([
    await loadToml(join(skillDir, 'customize.toml')),
    await loadToml(join(customDir, `${skillName}.toml`)),
    await loadToml(join(customDir, `${skillName}.user.toml`)),
  ])
}

/**
 * Load and merge BMAD's four-layer central configuration TOML.
 *
 * Layer order (lowest to highest priority):
 * 1. `{projectRoot}/_bmad/config.toml` — installer-managed defaults
 * 2. `{projectRoot}/_bmad/config.user.toml` — installer-managed user answers
 * 3. `{projectRoot}/_bmad/custom/config.toml` — team overrides
 * 4. `{projectRoot}/_bmad/custom/config.user.toml` — personal overrides
 *
 * @param projectRoot - absolute path to the project root containing `_bmad/`.
 * @returns the merged central config table.
 */
export async function loadCentralConfig(projectRoot: string): Promise<TomlLayer> {
  const bmadDir = join(projectRoot, '_bmad')
  const customDir = join(bmadDir, 'custom')
  return mergeLayers([
    await loadToml(join(bmadDir, 'config.toml')),
    await loadToml(join(bmadDir, 'config.user.toml')),
    await loadToml(join(customDir, 'config.toml')),
    await loadToml(join(customDir, 'config.user.toml')),
  ])
}

/**
 * Extract a dotted-key path from a merged TOML object.
 * @param data - the merged TOML table.
 * @param dottedKey - dot-separated path (e.g., `agent.identity`).
 * @returns the value at the path, or `undefined` when absent.
 */
export function extractKey(data: unknown, dottedKey: string): unknown {
  let current: unknown = data
  for (const part of dottedKey.split('.')) {
    if (isPlainObject(current) && part in current) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Find the project root by walking up from `start` until a directory containing
 * `_bmad/` or `.git/` is found. Mirrors `find_project_root` in the Python script.
 * @param start - the directory to start searching from.
 * @returns the resolved project root, or `undefined` when none is found.
 */
export function findProjectRoot(start: string): string | undefined {
  let current = resolve(start)
  while (true) {
    if (
      existsSync(join(current, '_bmad')) ||
      existsSync(join(current, '.git'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
