# `@deepseek-ai/dsh-bmad`

[中文](README.zh.md) | English

BMAD Method adapter bundle for DeepSeek Harness: native `customize.toml` resolution, config-to-prompt-variable bridging, and BMAD role agent presets — no Python or uv required.

## What it does

Projects that have [BMAD Method](https://github.com/bmad-code-org/bmad-method) installed gain two native adapters that replace BMAD's Python runtime:

1. **Config provider** (`bmad-config`): reads `_bmad/config.toml` (four-layer merge) and registers BMAD config values as DSH prompt variables (`{{bmad_user_name}}`, `{{bmad_project_name}}`, `{{bmad_communication_language}}`, etc.). Skills that reference these values resolve them from the system prompt without reading files.

2. **Customize resolver tool** (`bmad_resolve_customize`): a model-facing tool that natively merges a BMAD skill's three-layer `customize.toml` (defaults → team → user) and returns JSON. Replaces the `uv run resolve_customization.py` command.

When `_bmad/` is absent, both adapters are no-ops — the config provider registers nothing and the tool reports the skill directory not found. This is valid empty state for projects without BMAD.

## Quick start

### 1. Install BMAD in your project

```bash
cd your-project
npx bmad-method install --yes --tools cursor --modules bmm
```

This installs 49 BMAD skills into `.agents/skills/` and BMAD's runtime files into `_bmad/`. DSH's skill-filesystem provider already scans `.agents/skills/` (rank 200), so the skills appear in the DSH catalog automatically.

### 2. Enable the bmad bundle in DSH

Edit `~/.dsh/profiles/web/cordis.patch.yml` and append:

```yaml
- insert:
    - id: bmad-config
      name: '@deepseek-ai/dsh-bmad'
    - id: bmad-customize
      name: '@deepseek-ai/dsh-bmad/customize'
```

Refresh the DSH web page. The HMR watcher detects the patch file change and reloads the composition.

### 3. Install BMAD role presets (one-time)

Copy the five role presets into your DSH user preset directory:

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r <dsh-checkout>/apps/cli/config/agent-presets/bmad-* ~/.dsh/.agent-presets/
```

After refresh, the preset picker shows five BMAD roles under the custom section.

## BMAD role presets

Five role agent presets are available. Each mounts a BMAD persona via `@deepseek-ai/dsh-persona`, plus skill discovery and the standard tool set.

| Preset | Persona | Role | Key skills |
|---|---|---|---|
| `bmad-pm` | John | Product Manager | `bmad-prd`, `bmad-create-epics-and-stories`, `bmad-sprint-planning` |
| `bmad-architect` | Winston | System Architect | `bmad-architecture`, `bmad-sprint-planning` |
| `bmad-dev` | Amelia | Senior Software Engineer | `bmad-build`, `bmad-code-review`, `bmad-qa-generate-e2e-tests` |
| `bmad-ux` | Sally | UX Designer | `bmad-ux` |
| `bmad-analyst` | Mary | Business Analyst | `bmad-brainstorming`, `bmad-deep-recon`, `bmad-product-brief`, `bmad-prfaq` |

The `bmad-dev` preset also includes delegation tools (`subagent`, `subagent_fork`, `workflow`) because `bmad-build` spawns subagents for review and verification.

### Using a role

1. Open DSH, create a new session.
2. In the preset picker, select a BMAD role (e.g., `BMad PM (John)`).
3. The agent activates with that persona — greeting, communication style, and decision principles come from BMAD's `customize.toml`.
4. Invoke any BMAD skill (e.g., type "create a PRD" and the model loads `bmad-prd`).

### What happens when a skill activates

BMAD skills instruct the model to resolve their `customize.toml` on activation. Without this bundle, the model runs `uv run resolve_customization.py` — requiring Python 3.11+ and uv.

With this bundle, each preset's persona text tells the model to call `bmad_resolve_customize` instead. The tool returns the same merged JSON natively, so no Python is needed.

The model can also call the tool directly at any time:

```
bmad_resolve_customize(skill: "bmad-agent-pm", key: "agent")
```

Returns:

```json
{
  "name": "John",
  "title": "Product Manager",
  "icon": "📋",
  "role": "Translate product vision into a validated PRD...",
  "identity": "Thinks like Marty Cagan and Teresa Torres...",
  "communication_style": "Detective's 'why?' relentless...",
  "principles": ["PRDs emerge from user interviews...", ...]
}
```

## TOML merge rules

The native resolver mirrors BMAD's Python `config_utils.py` exactly:

- **Scalars**: override wins
- **Tables**: recursive deep-merge
- **Arrays-of-tables keyed by `code` or `id`**: replace matching items, append new ones
- **All other arrays**: append

### Customization layers (per skill)

| Layer | Path | Purpose |
|---|---|---|
| Defaults | `{skillDir}/customize.toml` | Shipped with the skill |
| Team | `_bmad/custom/{skillName}.toml` | Team overrides (committed) |
| User | `_bmad/custom/{skillName}.user.toml` | Personal overrides (gitignored) |

### Central config layers

| Layer | Path | Purpose |
|---|---|---|
| Installer defaults | `_bmad/config.toml` | Regenerated on each install |
| Installer user | `_bmad/config.user.toml` | Personal install answers |
| Team | `_bmad/custom/config.toml` | Team overrides (committed) |
| Personal | `_bmad/custom/config.user.toml` | Personal overrides (gitignored) |

## Registered prompt variables

When BMAD is installed, the config provider registers these variables:

| Variable | Config path | Example value |
|---|---|---|
| `{{bmad_user_name}}` | `core.user_name` | `Tester` |
| `{{bmad_project_name}}` | `core.project_name` | `my-project` |
| `{{bmad_communication_language}}` | `core.communication_language` | `English` |
| `{{bmad_document_output_language}}` | `core.document_output_language` | `English` |
| `{{bmad_output_folder}}` | `core.output_folder` | `_bmad-output` |
| `{{bmad_user_skill_level}}` | `modules.bmm.user_skill_level` | `intermediate` |
| `{{bmad_planning_artifacts}}` | `modules.bmm.planning_artifacts` | `{project-root}/_bmad-output/planning-artifacts` |
| `{{bmad_implementation_artifacts}}` | `modules.bmm.implementation_artifacts` | `{project-root}/_bmad-output/implementation-artifacts` |
| `{{bmad_project_knowledge}}` | `modules.bmm.project_knowledge` | `{project-root}/docs` |

## Config

| Field | Default | Meaning |
|---|---|---|
| `projectRoot` | nearest `.git` or `_bmad` ancestor of cwd | Project root containing `_bmad/` |

```yaml
- id: bmad-config
  name: '@deepseek-ai/dsh-bmad'
  config:
    projectRoot: /path/to/your/project
```

Omit `projectRoot` to auto-resolve from the agent's session cwd.

## Architecture

```
dsh-bmad bundle
├── src/merge.ts          TOML parse + structural merge (port of config_utils.py)
├── src/index.ts          Config provider plugin (registers prompt variables)
├── src/customize.ts      bmad_resolve_customize tool (model-facing)
├── src/invariant.ts      Package invariant companion
└── cordis.patch.yml      Bundle patch (inserts bmad-config + bmad-customize rows)
```

Role presets live separately in the user's `~/.dsh/.agent-presets/` directory — they are agent-plane compositions, not host-plane bundle rows.

## Model Experience

### Config provider

#### What the model sees

When BMAD is installed, the system prompt carries `{{bmad_user_name}}`, `{{bmad_project_name}}`, and other BMAD config variables resolved from `_bmad/config.toml`. When BMAD is absent, no variables are registered and the prompt is unchanged.

#### KV Cache effect

Variables are resolved once at activation and remain stable for the agent's lifetime. The values never change while the agent runs, so the prompt prefix is cache-stable.

### Customize resolver tool

#### What the model sees

The `bmad_resolve_customize` tool schema in the tool catalog, plus the tool result containing the merged customization JSON when called.

#### KV Cache effect

The tool schema is prefix-stable while the tool is visible. Tool results are append-only history.

## Known Limitations and Deferred Work

- **The tool does not intercept skill loading** — BMAD skill bodies still contain the `uv run resolve_customization.py` instruction. The persona text in each preset tells the model to prefer `bmad_resolve_customize`, but a skill loaded without a BMAD preset (e.g., from the `standard` preset) will still see the Python instruction. A future enhancement could intercept skill body loading to rewrite the instruction.
- **Only `bmm` module config is mapped** — the config provider maps `core` and `modules.bmm` values. Additional BMAD modules (bmb, cis, gds, tea) would need their own variable mappings.
- **Agent roster is static** — the 5 role presets are derived from BMAD's shipped `customize.toml`. Custom agents added via `_bmad/custom/config.toml` are not discovered as presets.
- **BMAD scripts still need Python** — some BMAD skills (e.g., `bmad-sprint-planning`, `bmad-retrospective`) call Python scripts like `sprint_plan.py` and `git_evidence.py` at runtime. These are skill-internal tools, not activation requirements, and remain unchanged.
