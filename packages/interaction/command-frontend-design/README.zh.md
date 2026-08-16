# @deepseek-ai/dsh-command-frontend-design

面向人类的 `/frontend-design` 命令。该插件通过
[`ctx.commands`](../../interaction/commands/README.md) 注册一个全局命令，因此所有
组合的指令适配器都能发现它；UI 适配器执行它时不会启动模型轮次。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/frontend-design` | 加载 `frontend-design` skill 并将其网页设计准则渲染回给用户。 |
| skill 缺失 | 直接返回错误结果，指明缺失的 skill；不启动模型轮次。 |

该命令是一个"加载并渲染"的薄壳。真正的准则位于磁盘 skill
`.agents/skills/frontend-design/SKILL.md`，由
[文件系统 skill provider](../../skill/skill-filesystem/README.md) 发现并注册进
[`ctx.skills`](../../skill/skill/README.md)。handler 调用
`ctx.skills.get('frontend-design', { cwd, signal })`，用 `renderSkillContent` 渲染
加载到的定义；传入调用方 `signal` 使加载可被取消。

## 本插件做什么、不做什么

该插件只注入 `commands` 与 `skills`。它不启动任何模型工作：渲染出的准则作为命令结果
直接返回给 UI 显示。原始命令输入被忽略，因为 skill 内容是固定的；该命令是一种刻意的
人类手势，按需呈现设计准则。

由于 skill 是磁盘 skill，它可以按项目或用户覆盖——在更高 rank 的 skill 根目录下放置
另一个 `frontend-design/SKILL.md` 即可；它无需改代码即可演进——编辑 Markdown 即可。

## 组合

在任意 cordis profile 中挂载命令注册表与本插件：

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

当文件系统 provider 的 `includeDefaultRoots` 启用时，`frontend-design` skill 会从默认
skill 根目录（含仓库的 `.agents/skills`）中被发现。可运行的组装示例见
[`examples/frontend-design-demo`](../../../examples/frontend-design-demo)。
