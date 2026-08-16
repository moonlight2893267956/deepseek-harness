import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as commandFrontendDesign from '@deepseek-ai/dsh-command-frontend-design'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent over a store-owned session, as an app's spine does. */
function stubAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return agent
}

/**
 * Mount the real command and skill registries plus this producer. With
 * `withSkill`, also register a runtime `frontend-design` skill so the command
 * has something to render; without it, the command must report the skill absent.
 */
async function harness(withSkill: boolean): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SkillRegistry)
  if (withSkill) {
    ctx.skills.register({
      name: 'frontend-design',
      description: 'Frontend design guidance.',
      source: 'runtime',
      content: 'Prefer distinctive typography and intentional color.',
      invocation: { modelInvocable: true, userInvocable: true },
    })
  }
  const agent = stubAgent(ctx, `command-frontend-design-${Math.random()}`)
  ctx.agents.register(agent)
  const plugin = await ctx.plugin(commandFrontendDesign)
  return { ctx, agent, plugin }
}

/** Execute `/frontend-design` through the same registry boundary as a UI adapter. */
async function run(test: Harness): Promise<{ kind: string; text?: string }> {
  const settled = await test.ctx.commands.execute(
    test.agent,
    '/frontend-design',
    new AbortController().signal,
  )
  if (settled === undefined) throw new Error('frontend-design command was not registered')
  return settled.result
}

describe('@deepseek-ai/dsh-command-frontend-design registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness(true)
    expect(commandFrontendDesign.name).toBe('command-frontend-design')
    expect(commandFrontendDesign.inject).toEqual(['commands', 'skills'])
    expect('default' in commandFrontendDesign).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandFrontendDesign)).toBe(commandFrontendDesign)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'frontend-design',
      description: 'load the frontend-design skill and render its web design guidance',
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'frontend-design')).toBeUndefined()
  })
})

describe('/frontend-design human command', () => {
  it('renders the loaded skill guidance without a model turn', async () => {
    const test = await harness(true)
    const result = await run(test)
    expect(result.kind).toBe('success')
    expect(result.text ?? '').toContain('frontend-design')
  })

  it('returns an error when the skill is absent from the workspace', async () => {
    const test = await harness(false)
    const result = await run(test)
    expect(result.kind).toBe('error')
    expect(result.text ?? '').toContain('"frontend-design" skill is not available')
  })

  it('does not start a model round when the skill is present', async () => {
    const test = await harness(true)
    const result = await run(test)
    expect(result.kind).toBe('success')
    // No model-facing content leaks beyond the rendered skill text.
    expect((result.text ?? '').toLowerCase()).not.toContain('model request')
  })
})
