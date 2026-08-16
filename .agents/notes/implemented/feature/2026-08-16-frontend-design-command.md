# Agent Note: `frontend-design` human command and disk skill

Status: implemented

English | [中文](2026-08-16-frontend-design-command.zh.md)

## Problem

A frontend design skill existed only inside the CodeBuddy IDE process, on the
`@command://frontend-design` trigger, and was unreachable from the harness's own
agent. Bringing that capability into the harness lets its agent and its human
operators apply the same design guidance, enabled two ways: a `/frontend-design`
slash command in the chat UI, and a plain cordis mount so any profile can enable
it without a bridge.

## Decision

Ship the skill as a disk skill and the command as a thin load-and-render plugin.

### Disk skill (zero code)

`.agents/skills/frontend-design/SKILL.md` holds the guidance. It uses YAML
frontmatter with `name`, `description`, and
`invocation: { modelInvocable: true, userInvocable: true }`, so both the model
and human command surfaces discover it. The filesystem skill provider scans
`.agents/skills` (rank 200) by default, so the skill registers with no plugin
code and can be overridden per project or user by a higher-ranked root.

### Command plugin

`@deepseek-ai/dsh-command-frontend-design` in
`packages/interaction/commands/command-frontend-design` injects `commands` and
`skills`, then registers one global command:

```ts
ctx.commands.register({
  name: 'frontend-design',
  description: 'load the frontend-design skill and render its web design guidance',
  handler: invocation => executeFrontendDesignCommand(invocation, ctx),
})
```

The handler calls `ctx.skills.get('frontend-design', { cwd: invocation.cwd, signal: invocation.signal })`. If the skill is absent it returns a `CommandResult` of `kind: 'error'` naming the missing skill; otherwise it renders the loaded definition with `renderSkillContent` and returns `kind: 'success'`. Passing the caller `signal` keeps the load cancelable; raw input is ignored because the skill content is fixed.

### Human command boundary

The command runs in the human-only command plane: it does not turn its input into
`user/message`, emits no session event, and starts no model turn. The rendered
guidance returns directly to the UI. This follows the `/feedback` precedent —
a deliberate human gesture surfaces design criteria on demand, with zero model
tokens.

### CLI / cordis enablement

The command plugin is an ordinary Cordis plugin. Any profile that mounts
`commands`, `skills`, and `skill-filesystem` enables `/frontend-design` by adding
one entry: `- name: '@deepseek-ai/dsh-command-frontend-design'`. The skill is
found through the provider's default roots, so no extra skill wiring is needed.
`examples/frontend-design-demo/cordis.yml` is a reusable composition fragment
that includes all four plugins; mount it via `@deepseek-ai/cordis-plugin-include`
into an existing profile's patch layer.

## Testing

The package suite (`command-frontend-design.spec.ts`) boots the real
`CommandRuntime`, `SkillRegistry`, and a runtime `frontend-design` skill, then
asserts through `ctx.commands.execute`:

- registration exposes exactly the `frontend-design` command and disposes it;
- the success result renders the loaded skill content;
- an absent skill yields the `error` result with the missing-skill message;
- no model-facing content is produced.

The skill content itself is exercised by the filesystem provider's scan in any
profile that includes the default roots.

## Alternatives considered

- **Runtime `ctx.skills.register()` instead of a disk skill** — rejected because
  a disk skill is overridable per project/user, needs no code to evolve, and
  matches the repo's "disk is configuration" convention; the plugin stays a thin
  shell.
- **Route the command through the model as a tool** — rejected: command-plane
  dispatch is human UI behavior; routing through the model adds latency, token
  cost, and reinterpretation, and the skill is already `modelInvocable` for
  agent-driven use.
- **Bridge to the CodeBuddy skill subprocess** — rejected: the user wanted an
  in-harness equivalent independent of the IDE side.

## Consequences

- Harness operators get `/frontend-design` in any UI that consumes the command
  registry, and any profile can enable it with one plugin entry.
- The skill is editable Markdown and overridable by skill-root rank; the command
  never needs to change when guidance changes.
- The human command costs zero model tokens and cannot be reinterpreted by the
  model.

## Known limitations and deferred work

- The command ignores raw input; if future guidance must be parameterized per
  request, the handler would parse `invocation.rawInput` into skill arguments.
- Like all command-plane commands, output is live-only and not reconstructed
  after UI restart.
