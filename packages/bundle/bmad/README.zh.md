# `@deepseek-ai/dsh-bmad`

[English](README.md) | 中文

BMAD Method 适配器 bundle，用于 DeepSeek Harness：原生 `customize.toml` 解析、配置到 prompt 变量的桥接，以及 BMAD 角色 agent preset——无需 Python 或 uv。

## 功能

安装了 [BMAD Method](https://github.com/bmad-code-org/bmad-method) 的项目获得两个原生适配器，替代 BMAD 的 Python 运行时：

1. **配置提供器**（`bmad-config`）：读取 `_bmad/config.toml`（四层合并），将 BMAD 配置值注册为 DSH prompt 变量（`{{bmad_user_name}}`、`{{bmad_project_name}}`、`{{bmad_communication_language}}` 等）。引用这些值的 skill 从系统 prompt 解析，无需读文件。

2. **Customize 解析工具**（`bmad_resolve_customize`）：一个 model-facing 工具，原生合并 BMAD skill 的三层 `customize.toml`（defaults → team → user）并返回 JSON。替代 `uv run resolve_customization.py` 命令。

当 `_bmad/` 不存在时，两个适配器均为 no-op——配置提供器不注册任何内容，工具报告 skill 目录未找到。这是没有 BMAD 的项目的有效空状态。

## 快速开始

### 1. 在项目中安装 BMAD

```bash
cd your-project
npx bmad-method install --yes --tools cursor --modules bmm
```

这会将 49 个 BMAD skill 安装到 `.agents/skills/`，将 BMAD 运行时文件安装到 `_bmad/`。DSH 的 skill-filesystem 提供器已扫描 `.agents/skills/`（rank 200），因此 skill 会自动出现在 DSH catalog 中。

### 2. 在 DSH 中启用 bmad bundle

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，追加：

```yaml
- insert:
    - id: bmad-config
      name: '@deepseek-ai/dsh-bmad'
    - id: bmad-customize
      name: '@deepseek-ai/dsh-bmad/customize'
```

刷新 DSH 页面。HMR watcher 检测到 patch 文件变更后重新加载组合。

### 3. 安装 BMAD 角色 preset（一次性）

将五个角色 preset 复制到 DSH 用户 preset 目录：

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r <dsh-checkout>/apps/cli/config/agent-presets/bmad-* ~/.dsh/.agent-presets/
```

刷新后，preset 选择器在自定义分区下显示五个 BMAD 角色。

## BMAD 角色 preset

五个角色 agent preset 可用。每个通过 `@deepseek-ai/dsh-persona` 挂载一个 BMAD persona，加上 skill 发现和标准工具集。

| Preset | Persona | 角色 | 关键 skill |
|---|---|---|---|
| `bmad-pm` | John | Product Manager | `bmad-prd`, `bmad-create-epics-and-stories`, `bmad-sprint-planning` |
| `bmad-architect` | Winston | System Architect | `bmad-architecture`, `bmad-sprint-planning` |
| `bmad-dev` | Amelia | Senior Software Engineer | `bmad-build`, `bmad-code-review`, `bmad-qa-generate-e2e-tests` |
| `bmad-ux` | Sally | UX Designer | `bmad-ux` |
| `bmad-analyst` | Mary | Business Analyst | `bmad-brainstorming`, `bmad-deep-recon`, `bmad-product-brief`, `bmad-prfaq` |

`bmad-dev` preset 还包含委派工具（`subagent`、`subagent_fork`、`workflow`），因为 `bmad-build` 会 spawn subagent 进行 review 和 verification。

### 使用角色

1. 打开 DSH，创建新会话。
2. 在 preset 选择器中选择一个 BMAD 角色（如 `BMad PM (John)`）。
3. agent 以该 persona 激活——问候语、沟通风格和决策原则来自 BMAD 的 `customize.toml`。
4. 调用任何 BMAD skill（如输入"create a PRD"，模型加载 `bmad-prd`）。

### skill 激活时发生什么

BMAD skill 指示模型在激活时解析其 `customize.toml`。没有此 bundle 时，模型运行 `uv run resolve_customization.py`——需要 Python 3.11+ 和 uv。

有此 bundle 时，每个 preset 的 persona 文本告诉模型改为调用 `bmad_resolve_customize`。该工具原生返回相同的合并 JSON，无需 Python。

模型也可在任何时候直接调用该工具：

```
bmad_resolve_customize(skill: "bmad-agent-pm", key: "agent")
```

返回：

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

## TOML 合并规则

原生解析器完全镜像 BMAD 的 Python `config_utils.py`：

- **标量**：override 胜出
- **表**：递归深合并
- **以 `code` 或 `id` 为键的 array-of-tables**：替换匹配项，追加新项
- **所有其他数组**：追加

### Customization 层级（每个 skill）

| 层级 | 路径 | 用途 |
|---|---|---|
| Defaults | `{skillDir}/customize.toml` | 随 skill 发布 |
| Team | `_bmad/custom/{skillName}.toml` | 团队覆盖（提交到 git） |
| User | `_bmad/custom/{skillName}.user.toml` | 个人覆盖（gitignore） |

### Central config 层级

| 层级 | 路径 | 用途 |
|---|---|---|
| 安装器默认 | `_bmad/config.toml` | 每次安装重新生成 |
| 安装器用户 | `_bmad/config.user.toml` | 个人安装回答 |
| Team | `_bmad/custom/config.toml` | 团队覆盖（提交到 git） |
| Personal | `_bmad/custom/config.user.toml` | 个人覆盖（gitignore） |

## 注册的 prompt 变量

BMAD 安装后，配置提供器注册以下变量：

| 变量 | 配置路径 | 示例值 |
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

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `projectRoot` | cwd 最近的 `.git` 或 `_bmad` 祖先 | 包含 `_bmad/` 的项目根 |

```yaml
- id: bmad-config
  name: '@deepseek-ai/dsh-bmad'
  config:
    projectRoot: /path/to/your/project
```

省略 `projectRoot` 以从 agent 的 session cwd 自动解析。

## 架构

```
dsh-bmad bundle
├── src/merge.ts          TOML parse + structural merge (port of config_utils.py)
├── src/index.ts          Config provider plugin (registers prompt variables)
├── src/customize.ts      bmad_resolve_customize tool (model-facing)
├── src/invariant.ts      Package invariant companion
└── cordis.patch.yml      Bundle patch (inserts bmad-config + bmad-customize rows)
```

角色 preset 单独存在于用户的 `~/.dsh/.agent-presets/` 目录——它们是 agent-plane 组合，不是 host-plane bundle 行。

## Model Experience

### 配置提供器

#### 模型所见

BMAD 安装后，系统 prompt 携带 `{{bmad_user_name}}`、`{{bmad_project_name}}` 等从 `_bmad/config.toml` 解析的 BMAD 配置变量。BMAD 不存在时不注册变量，prompt 不变。

#### KV Cache 影响

变量在激活时解析一次，在 agent 生命周期内保持稳定。值在 agent 运行期间不会改变，因此 prompt 前缀是 cache-stable 的。

### Customize 解析工具

#### 模型所见

工具 catalog 中的 `bmad_resolve_customize` 工具 schema，以及调用时返回的合并 customization JSON。

#### KV Cache 影响

工具 schema 在工具可见时是 prefix-stable 的。工具结果是 append-only history。

## Known Limitations and Deferred Work

- **工具不拦截 skill 加载** — BMAD skill body 仍包含 `uv run resolve_customization.py` 指令。每个 preset 的 persona 文本告诉模型优先使用 `bmad_resolve_customize`，但未通过 BMAD preset 加载的 skill（如从 `standard` preset）仍会看到 Python 指令。未来可拦截 skill body 加载以重写该指令。
- **仅映射 `bmm` 模块配置** — 配置提供器映射 `core` 和 `modules.bmm` 值。其他 BMAD 模块（bmb、cis、gds、tea）需要自己的变量映射。
- **Agent 名单是静态的** — 5 个角色 preset 源自 BMAD 发布的 `customize.toml`。通过 `_bmad/custom/config.toml` 添加的自定义 agent 不会被发现为 preset。
- **BMAD 脚本仍需 Python** — 部分 BMAD skill（如 `bmad-sprint-planning`、`bmad-retrospective`）在运行时调用 Python 脚本如 `sprint_plan.py` 和 `git_evidence.py`。这些是 skill 内部工具，非激活需求，保持不变。
