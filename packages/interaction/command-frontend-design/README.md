# @deepseek-ai/dsh-command-frontend-design

English | [中文](README.zh.md)

Human-facing `/frontend-design` command. The plugin registers one global command
through [`ctx.commands`](../../interaction/commands/README.md), so every composed
command adapter discovers it; a UI adapter executes it without a model turn.

## Command contract

| Input | Result |
|---|---|
| `/frontend-design` | Load the `frontend-design` skill and render its web-design guidance back to the user. |
| skill absent | Return a direct error result naming the missing skill; no model turn starts. |

The command is a thin load-and-render shell. The actual guidance lives in the
`frontend-design` disk skill at `.agents/skills/frontend-design/SKILL.md`, which
the [filesystem skill provider](../../skill/skill-filesystem/README.md) discovers
and registers into [`ctx.skills`](../../skill/skill/README.md). The handler calls
`ctx.skills.get('frontend-design', { cwd, signal })` and renders the loaded
definition with `renderSkillContent`; passing the caller `signal` keeps the load
cancelable.

## What this plugin does and does not do

The plugin injects `commands` and `skills` only. It starts no model work: the
rendered guidance is returned as the command result for the UI to display. Raw
command input is ignored, since the skill content is fixed; the command is a
deliberate human gesture that surfaces design criteria on demand.

Because the skill is a disk skill, it can be overridden per project or user by
placing another `frontend-design/SKILL.md` higher in the skill-root rank, and it
requires no code change to evolve — edit the Markdown.

## Composition

Mount the command registry plus this plugin in any cordis profile:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: skills
  name: '@deepseek-ai/dsh-skill'
- id: skill-fs
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: frontend-design-cmd
  name: '@deepseek-ai/dsh-command-frontend-design'
```

The `frontend-design` skill is then discovered from the default skill roots
(including the repository's `.agents/skills`) when the filesystem provider's
`includeDefaultRoots` is enabled. See
[`examples/frontend-design-demo`](../../../examples/frontend-design-demo) for a
runnable assembly.
