# frontend-design-demo

中文 | [English](README.md)

一个把 `/frontend-design` 命令接入任意 harness profile 的组合片段。

命令本体位于
[`@deepseek-ai/dsh-command-frontend-design`](../../packages/interaction/command-frontend-design)。
它通过 `ctx.commands` 注册一个全局命令，并将 `frontend-design` 磁盘 skill
(`.agents/skills/frontend-design/SKILL.md`) 渲染回给用户，全程不启动模型轮次。

## 本片段挂载了什么

| 插件 | 用途 |
|---|---|
| `@deepseek-ai/dsh-commands` | 每个命令适配器读取的全局命令注册表。 |
| `@deepseek-ai/dsh-skill` | 持有已发现磁盘 skill 的 skill 注册表。 |
| `@deepseek-ai/dsh-skill-filesystem` | 扫描 `.agents/skills`、`$DSH_HOME/skills` 等目录以发现该 skill。 |
| `@deepseek-ai/dsh-command-frontend-design` | 注册并渲染 `/frontend-design`。 |

`frontend-design` skill 通过文件系统 provider 的默认根目录被发现，因此本片段
不需要额外配置 skill 路径。

## 如何启用

### 1. Slash 命令（UI）

片段组合完成后，在任意暴露命令适配器的聊天 UI 中输入 `/frontend-design`。
命令直接返回渲染后的 skill 准则；不会提示模型。

### 2. CLI / cordis（profile）

把片段加入 profile 的 patch layer，使其在基础配置之上组合。在 profile 的
`cordis.patch.yml` 中：

```yaml
- name: '@deepseek-ai/cordis-plugin-include'
  config:
    include:
      - './frontend-design-demo/cordis.yml'
```

或者，如果你只需要命令，且已在别处挂载 `commands` + `skills` +
`skill-filesystem`，仅添加该插件即可：

```yaml
- id: frontend-design-cmd
  name: '@deepseek-ai/dsh-command-frontend-design'
```

因为一切都是插件，profile 一启动命令即可用——无需额外桥接、无需手动注册。

## 行为

| 输入 | 结果 |
|---|---|
| `/frontend-design`（skill 存在） | 返回渲染后的 skill 准则。 |
| `/frontend-design`（skill 缺失） | 返回直接错误并指明缺失的 skill。 |
| 模型侧 | 该 skill 也是 `modelInvocable`，因此 agent 可以自行加载它。 |
