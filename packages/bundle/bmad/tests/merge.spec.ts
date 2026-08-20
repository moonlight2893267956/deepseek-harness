import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadToml,
  structuralMerge,
  mergeArrays,
  mergeLayers,
  loadCustomization,
  loadCentralConfig,
  extractKey,
  findProjectRoot,
} from '../src/merge.ts'

const TMP = join(tmpdir(), `bmad-merge-test-${Date.now()}`)
let projectRoot: string
let skillDir: string

async function setupProject(structure: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = join(projectRoot, relPath)
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }
}

beforeEach(async () => {
  projectRoot = join(TMP, `proj-${Math.random().toString(36).slice(2)}`)
  skillDir = join(projectRoot, '.agents', 'skills', 'bmad-test-skill')
  await mkdir(skillDir, { recursive: true })
})

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('loadToml', () => {
  it('parses a valid TOML file', async () => {
    const filePath = join(projectRoot, 'test.toml')
    await writeFile(filePath, 'key = "value"\nnum = 42\n', 'utf8')
    const result = await loadToml(filePath)
    expect(result).toEqual({ key: 'value', num: 42 })
  })

  it('returns empty object for missing file', async () => {
    const result = await loadToml(join(projectRoot, 'nonexistent.toml'))
    expect(result).toEqual({})
  })

  it('throws on parse error', async () => {
    const filePath = join(projectRoot, 'bad.toml')
    await writeFile(filePath, 'key = \n', 'utf8')
    await expect(loadToml(filePath)).rejects.toThrow(/failed to parse/)
  })
})

describe('structuralMerge', () => {
  it('scalars: override wins', () => {
    expect(structuralMerge({ a: 'base' }, { a: 'override' })).toEqual({ a: 'override' })
  })

  it('tables: deep merge', () => {
    const base = { agent: { name: 'John', role: 'pm' } }
    const override = { agent: { role: 'architect', extra: 'val' } }
    expect(structuralMerge(base, override)).toEqual({
      agent: { name: 'John', role: 'architect', extra: 'val' },
    })
  })

  it('plain arrays: append', () => {
    const base = { items: ['a', 'b'] }
    const override = { items: ['c'] }
    expect(structuralMerge(base, override)).toEqual({ items: ['a', 'b', 'c'] })
  })

  it('keyed arrays (code): replace matching, append new', () => {
    const base = { menu: [{ code: 'PRD', desc: 'base' }, { code: 'UX', desc: 'base' }] }
    const override = { menu: [{ code: 'PRD', desc: 'override' }, { code: 'NEW', desc: 'new' }] }
    const result = structuralMerge(base, override) as { menu: Array<{ code: string; desc: string }> }
    expect(result.menu).toHaveLength(3)
    expect(result.menu.find(m => m.code === 'PRD')?.desc).toBe('override')
    expect(result.menu.find(m => m.code === 'UX')?.desc).toBe('base')
    expect(result.menu.find(m => m.code === 'NEW')?.desc).toBe('new')
  })

  it('keyed arrays (id): replace matching, append new', () => {
    const base = { items: [{ id: '1', val: 'base' }] }
    const override = { items: [{ id: '1', val: 'override' }, { id: '2', val: 'new' }] }
    const result = structuralMerge(base, override) as { items: Array<{ id: string; val: string }> }
    expect(result.items).toHaveLength(2)
    expect(result.items.find(i => i.id === '1')?.val).toBe('override')
    expect(result.items.find(i => i.id === '2')?.val).toBe('new')
  })
})

describe('mergeArrays', () => {
  it('non-keyed arrays concatenate', () => {
    expect(mergeArrays([1, 2], [3])).toEqual([1, 2, 3])
  })

  it('throws on non-string keyed field', () => {
    expect(() => mergeArrays([{ code: 123 }], [{ code: 'x' }])).toThrow(/must be a string/)
  })

  it('throws on empty keyed field value', () => {
    expect(() => mergeArrays([{ code: '' }], [{ code: 'x' }])).toThrow(/must not be empty/)
  })
})

describe('mergeLayers', () => {
  it('merges multiple layers in priority order', () => {
    const result = mergeLayers([
      { a: 'low', nested: { x: 1 } },
      { a: 'high', nested: { y: 2 } },
    ])
    expect(result).toEqual({ a: 'high', nested: { x: 1, y: 2 } })
  })

  it('empty layers contribute nothing', () => {
    expect(mergeLayers([{}, { a: 1 }, {}])).toEqual({ a: 1 })
  })
})

describe('loadCustomization', () => {
  it('merges three layers: defaults, team, user', async () => {
    await setupProject({
      '.agents/skills/bmad-test-skill/customize.toml': '[agent]\nname = "Base"\nrole = "default"\nprinciples = ["p1"]\n',
      '_bmad/custom/bmad-test-skill.toml': '[agent]\nrole = "team"\nprinciples = ["p2"]\n',
      '_bmad/custom/bmad-test-skill.user.toml': '[agent]\nrole = "user"\n',
    })

    const result = await loadCustomization(projectRoot, skillDir)
    const agent = result.agent as Record<string, unknown>
    expect(agent.name).toBe('Base')
    expect(agent.role).toBe('user')
    expect(agent.principles).toEqual(['p1', 'p2'])
  })

  it('works with only customize.toml present', async () => {
    await setupProject({
      '.agents/skills/bmad-test-skill/customize.toml': '[agent]\nname = "Solo"\n',
    })
    const result = await loadCustomization(projectRoot, skillDir)
    expect((result.agent as Record<string, unknown>).name).toBe('Solo')
  })

  it('returns empty when no customize.toml exists', async () => {
    const result = await loadCustomization(projectRoot, skillDir)
    expect(result).toEqual({})
  })
})

describe('loadCentralConfig', () => {
  it('merges four config layers', async () => {
    await setupProject({
      '_bmad/config.toml': '[core]\nuser_name = "installer"\nproject_name = "proj"\n',
      '_bmad/config.user.toml': '[core]\nuser_name = "user-override"\n',
      '_bmad/custom/config.toml': '[core]\nproject_name = "team-proj"\n',
      '_bmad/custom/config.user.toml': '[core]\ncommunication_language = "zh"\n',
    })
    const result = await loadCentralConfig(projectRoot)
    const core = result.core as Record<string, unknown>
    expect(core.user_name).toBe('user-override')
    expect(core.project_name).toBe('team-proj')
    expect(core.communication_language).toBe('zh')
  })

  it('returns empty when config.toml is missing', async () => {
    const result = await loadCentralConfig(projectRoot)
    expect(result).toEqual({})
  })
})

describe('extractKey', () => {
  it('extracts a dotted key path', () => {
    const data = { agent: { identity: { name: 'John' } } }
    expect(extractKey(data, 'agent.identity.name')).toBe('John')
  })

  it('returns undefined for missing path', () => {
    expect(extractKey({ a: 1 }, 'b.c')).toBeUndefined()
  })
})

describe('findProjectRoot', () => {
  it('finds _bmad ancestor', async () => {
    await setupProject({ '_bmad/config.toml': '' })
    const nested = join(projectRoot, 'deep', 'nested', 'dir')
    await mkdir(nested, { recursive: true })
    expect(findProjectRoot(nested)).toBe(projectRoot)
  })

  it('returns undefined when no _bmad or .git ancestor exists', () => {
    const unrelated = join(tmpdir(), `no-bmad-${Date.now()}`)
    expect(findProjectRoot(unrelated)).toBeUndefined()
  })
})
