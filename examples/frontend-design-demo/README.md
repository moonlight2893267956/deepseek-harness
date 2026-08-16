# frontend-design-demo

English | [中文](README.zh.md)

A composition fragment that wires the `/frontend-design` command into any
harness profile.

The command itself lives in
[`@deepseek-ai/dsh-command-frontend-design`](../../packages/interaction/command-frontend-design).
It registers one global command through `ctx.commands` and renders the
`frontend-design` disk skill (`.agents/skills/frontend-design/SKILL.md`) back to
the user without starting a model turn.

## What this fragment mounts

| Plugin | Why |
|---|---|
| `@deepseek-ai/dsh-commands` | The global command registry every command adapter reads. |
| `@deepseek-ai/dsh-skill` | The skill registry that holds the discovered disk skill. |
| `@deepseek-ai/dsh-skill-filesystem` | Scans `.agents/skills`, `$DSH_HOME/skills`, and friends for the skill. |
| `@deepseek-ai/dsh-command-frontend-design` | Registers and renders `/frontend-design`. |

The `frontend-design` skill is found through the filesystem provider's default
roots, so this fragment adds no skill paths.

## How to enable it

### 1. Slash command (UI)

Once the fragment is composed, type `/frontend-design` in any chat UI that
exposes the command adapter. The command returns the rendered skill guidance
directly; it does not prompt the model.

### 2. CLI / cordis (profile)

Add the fragment to a profile's patch layer so it composes over the base. In
the profile's `cordis.patch.yml`:

```yaml
- name: '@deepseek-ai/cordis-plugin-include'
  config:
    include:
      - './frontend-design-demo/cordis.yml'
```

Or, if you only want the command and already mount `commands` + `skills` +
`skill-filesystem` elsewhere, add just the plugin:

```yaml
- id: frontend-design-cmd
  name: '@deepseek-ai/dsh-command-frontend-design'
```

Because everything is a plugin, the command is available the moment its profile
boots — no extra bridge, no manual registration.

## Behavior

| Input | Result |
|---|---|
| `/frontend-design` (skill present) | Returns the rendered skill guidance. |
| `/frontend-design` (skill absent) | Returns a direct error naming the missing skill. |
| model-facing | The skill is also `modelInvocable`, so the agent can load it on its own. |
