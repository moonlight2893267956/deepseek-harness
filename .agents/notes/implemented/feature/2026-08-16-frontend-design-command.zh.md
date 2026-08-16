# Agent Note：frontend-design 人类命令与磁盘 skill

状态：已实现

[English](2026-08-16-frontend-design-command.md) | 中文

## 问题

原先的 frontend-design skill 只存在于 CodeBuddy IDE 进程内，由
`@command://frontend-design` 触发，harness 自身的 agent 无法使用。把该能力移入
harness，既能让 agent、也能让人类操作者套用同一套设计准则，并以两种方式启用：聊天
UI 里的 `/frontend-design` 斜杠命令，以及一个普通的 cordis 挂载，使任意 profile 无需
桥接即可启用。

## 决策

把 skill 作为磁盘 skill 提供，把命令作为一个"加载并渲染"的薄壳插件提供。

### 磁盘 skill（零代码）

`.agents/skills/frontend-design/SKILL.md` 承载设计准则。其 YAML frontmatter 含
`name`、`description` 与 `invocation: { modelInvocable: true, userInvocable: true }`，
因此模型与人类命令两个 surface 都能发现它。文件系统 skill provider 默认扫描
`.agents/skills`（rank 200），于是该 skill 无需插件代码即完成注册，并可由更高 rank
的根目录按项目或用户覆盖。

### 命令插件

`@deepseek-ai/dsh-command-frontend-design`（`packages/interaction/commands/command-frontend-design`）
注入 `commands` 与 `skills`，注册一个全局命令：

```ts
ctx.commands.register({
  name: 'frontend-design',
  description: 'load the frontend-design skill and render its web design guidance',
  handler: invocation => executeFrontendDesignCommand(invocation, ctx),
})
```

handler 调用 `ctx.skills.get('frontend-design', { cwd: invocation.cwd, signal: invocation.signal })`。
若 skill 缺失，返回 `kind: 'error'` 的 `CommandResult` 并指明缺失的 skill；否则用
`renderSkillContent` 渲染加载到的定义并返回 `kind: 'success'`。传入调用方 `signal`
使加载可取消；原始输入被忽略，因为 skill 内容是固定的。

### 人类命令边界

命令运行于人类专属的命令平面：它不会把输入变成 `user/message`、不产生 session 事件、
也不启动模型轮次。渲染出的准则直接回显给 UI。这遵循 `/feedback` 的先例——一种
刻意的人类手势按需呈现设计准则，零模型 token。

### CLI / cordis 启用

命令插件是一个普通 Cordis 插件。任意挂载了 `commands`、`skills` 与 `skill-filesystem`
的 profile，只需增加一项 `- name: '@deepseek-ai/dsh-command-frontend-design'` 即可启用
`/frontend-design`。skill 通过 provider 的默认根目录被发现，无需额外 skill 接线。
`examples/frontend-design-demo/cordis.yml` 是一个可复用的组合片段，包含全部四个插件；
通过 `@deepseek-ai/cordis-plugin-include` 挂载到已有 profile 的 patch 层即可。

## 测试

包内测试（`command-frontend-design.spec.ts`）引导真实的 `CommandRuntime`、
`SkillRegistry` 与一个运行时 `frontend-design` skill，再通过 `ctx.commands.execute`
断言：

- 注册恰好暴露 `frontend-design` 命令，并能在卸载时移除；
- success 结果渲染了加载到的 skill 内容；
- skill 缺失时返回带缺失提示的 `error` 结果；
- 不产生任何模型可见内容。

skill 内容本身由文件系统 provider 在包含默认根目录的任意 profile 中完成扫描验证。

## 备选方案

- **用运行时 `ctx.skills.register()` 而非磁盘 skill** —— 否决：磁盘 skill 可按项目/用户
  覆盖、改内容无需改代码，且契合仓库"磁盘即配置"的惯例；插件保持薄壳。
- **把命令作为工具经模型路由** —— 否决：命令平面分发是人类 UI 行为；经模型会增加延迟、
  token 成本与被重新解读的风险；且 skill 已设 `modelInvocable` 供 agent 驱动使用。
- **桥接到 CodeBuddy 的 skill 子进程** —— 否决：用户要的是与 IDE 侧无关的 harness 内
  等价能力。

## 影响

- harness 操作者在任何消费命令注册表的 UI 中都能用 `/frontend-design`，任意 profile 也能
  以一项插件启用它。
- skill 是可编辑的 Markdown，可经 skill-root rank 覆盖；准则变动时命令无需改动。
- 人类命令零模型 token，且不会被模型重新解读。

## 已知限制与待办

- 命令忽略原始输入；若未来准则需按请求参数化，handler 会解析 `invocation.rawInput`
  作为 skill 参数。
- 与所有命令平面命令一样，输出仅实时存在，UI 重启后不重建。
