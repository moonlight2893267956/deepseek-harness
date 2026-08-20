# 第三方开源插件开发规范

[English](opensource-plugin.md) | 中文

本篇以真实的开源 dsh 插件 [modlens](https://github.com/liustack/modlens)（视觉桥接：让纯文本模型也能"看"图）为范例，把散落在 [打包与安装](./publish.md)、[插件配置](./config.md)、[插件工具](./tool.md) 中的规则，针对**要发布给别人安装**的 out-of-tree 插件，整理成一套明确的开发规范。它假设你已读完前面的基础教程。

dsh 的运行时哲学是 **everything is a plugin**：插件就是一个 Cordis 模块，导出 `apply(ctx)` 函数，框架在加载时调用它，插件通过 `ctx` 注册能力（工具、服务、事件、路由等）。这套规范回答的是"如何把一个插件做成别人能 `dsh plugin add` 安装的包"。

## 一、两种插件形态

### 形态 1：开发期本地插件（`--patch` 覆盖）
最快的调试路径。直接写 `.ts`，用绝对路径在 `cordis.yml` / `cordis.patch.yml` 里 insert：

```yaml
- insert:
    - id: hello
      name: '/abs/path/to/my-plugin.ts'
```

启动：`pnpm dsh web --patch ./scratch-plugin/cordis.yml`。这条路线适合边写边调，但不产生可分发产物。

### 形态 2：可分发 bundle（开源插件标准形态）
你发布给别人装的形态。核心是一个 npm 包，带 `dsh.bundle` 清单。下文的规范都围绕这种形态。

## 二、bundle 目录结构与清单

以 modlens 为范例，对照官方 [publish.md](./publish.md)：

```
@liustack/modlens/
├── package.json        # declares dsh.bundle + dsh.client manifests
├── cordis.patch.yml    # plugin layer: insert one row referencing this package
├── dsh/index.js        # host-side (handler) entry (Node side)
├── dsh/client.js       # browser-side half (injected for the web profile)
├── dsh/vision-schema.json
├── src/                # the real engine/CLI source (built independently to dist/)
└── skills/modlens/     # optional: also ship as a skill for other harnesses
```

### `package.json` 关键字段（modlens 真实配置）

```json
{
  "name": "@liustack/modlens",
  "type": "module",
  "exports": { ".": "./dsh/index.js", "./client": "./dsh/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web", "immediately": true }
  }
}
```

- `dsh.bundle.patch` 指向 patch 文件——**没有这个声明的包装了也不会激活任何层**，只会作为普通依赖。
- `dsh.client` 描述浏览器半边：在哪个 `platform`（web）注入、是否 `immediately` 注入。
- 字段含义见 [publish.md](./publish.md) 的"两个概念，两种 manifest"。

### `cordis.patch.yml`（modlens 真实内容）

```yaml
- insert:
    - id: modlens
      name: '@liustack/modlens'
```

注意：patch 行引用**包名**而非路径，由 Node resolution 找到已安装代码（区别于本地 `--patch` 的绝对路径）。没有 `dsh.bundle` 声明的包，`dsh plugin` 只当普通依赖，不激活层。

## 三、插件入口编码规范（`dsh/index.js`）

### 基本骨架

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'modlens'
export const inject = ['tools', 'agents', 'attachments', 'llm']  // declare dependency services

export function apply(ctx: Context, config = {}) {
  // register disposables via ctx.effect()
}
```

### 必须遵守的规范（modlens 印证）

1. **`inject` 声明依赖**：框架会等这些服务就绪才加载插件（`tools` 注册表、`llm`、`attachments` 等）。缺少声明会导致注入为 `undefined` 而静默失败。

2. **能力通过 `ctx` 注册、且可清理**：`ctx.tools.register(...)` 等返回的 disposer 自动挂在插件上，卸载即反注册。所有长期资源一律走 `ctx.effect()`，保证卸载干净。

3. **零依赖 stance（关键）**：插件 handler 只用 Node 内置模块（`node:child_process`、`node:fs` 等），**不 import 任何 dsh 内部包**。modlens 注释明确写着 "Registered as a raw JSON-Schema tool definition (no dsh package imports)"——因为 out-of-tree 解析 `@deepseek-ai/dsh-*` 包还不可靠。把真正的引擎逻辑放进 `src/` 自构建，handler 只做编排。

4. **工具定义用原生 JSON Schema**，自己在校验参数。注册时把 `parameters`、`output` 直接写成 JSON Schema，而不是依赖 host 的类型系统：

```ts
const tool = {
  name: 'modlens_read_image',
  description: '...',
  parameters: { type: 'object', properties: { path: {...}, prompt: {...} }, required: ['path'] },
  output: { schema: OUTPUT_SCHEMA, render: (_args, value) => [...] },
  async execute(args) { /* spawn local CLI engine */ }
}
```

   - **工具名避开 host 已有名**（如 host 自带 `read_image`，就用 `modlens_read_image`）。这是 modlens 在 issue #34 上的教训：同名会冲突或让模型困惑。
   - `output.render` 是纯函数，按 [adding-a-tool](../../../cookbook/adding-a-tool.md) 的 UI 渲染意图写（`generic`/`terminal`/`diff` 等）。

5. **条件能力用 `ctx.inject` 函数式作用域**：web-only 的路由（如 paste-to-path、settings card）用 `ctx.inject(['webServer'], scope => { ... })` 包裹。headless profile 下 `webServer` 不存在，这段代码根本不会执行——而不是在 `apply` 里硬等 `webServer` 导致 headless 启动卡住。

6. **失败要响亮（fail loud）**：任何注册错误都 `console.error` 降级，而不是悄悄把整条能力链拖垮。modlens 在 issue #21 上确立：单个 vision wrapper 注册失败不应让整个插件静默失效。

## 四、双端插件（web profile）

web profile 的插件有**两个半边**：

- **handler 半边**（`dsh/index.js`，Node 端）：注册工具、提供 `/modlens/paste` 等 server 路由、`ctx.inject(['webServer'], ...)` 提供浏览器回调。
- **client 半边**（`dsh/client.js`，浏览器端）：手写为 `window.__ModuleLoader__.load({ id, factory })` 的懒加载 CJS 协议，**无构建步骤、不 import dsh 客户端包**。与 handler 同样的零依赖立场。modlens 用它拦截图片粘贴、转成路径文本注入 composer。

`package.json` 里用 `exports` 暴露两个入口（`.` 与 `./client`），并声明 `dsh.client` 让框架知道在哪注入 `./client`。

## 五、分发与安装流程（开源关键）

### 安装命令（给用户的）

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modlens@3.18.2
```

- `--profile web`：装到 web profile。
- **务必 pin 版本而非 `@latest`**：modlens 在 INSTALL.md 明确警告，pnpm 11 会扣留 24 小时内发布的新版本，导致装上旧版报 `declares no dsh.bundle`。命名版本号 pnpm 才会当"明确请求"处理。
- 安装后重启 dsh；model selector 出现 `(modlens vision)` 后缀即生效。

### 三种分发方式（官方 [publish.md](./publish.md) 对比）

| 方式 | 命令 | 构建权限要求 |
|---|---|---|
| npm 发布（推荐） | `dsh plugin add <pkg>` | 无（装预构建 `lib/`） |
| git 安装 | `dsh plugin add github:you/repo#<sha>` | 需用户在 `pnpm-workspace.yaml` 加 `allowBuilds` 允许 `prepare` 脚本构建 |
| 离线 tarball | `dsh plugin add ./pkg-0.1.0.tgz` | 无 |

**git 安装的坑（务必注意）**：拉的是源码不是构建产物，必须作者提供 `prepare` 脚本自行从 `src/` 构建（且不能依赖 monorepo 开发环境），否则 TS 包没有 `lib/` 直接加载失败。要用户授权 `allowBuilds` 本质是"允许在装机时执行该包代码"——务必 pin commit，别让后续 push 静默改变执行内容。详见 [publish.md 的"从 GitHub 安装"一节](./publish.md)。

### 配置层加载顺序（决定覆盖关系）

生效配置按序叠加，后层按 `id` 覆盖整行 `config`（**整行替换，非深合并**）：

1. profile 的 `dsh.profile.bundles` 列表顺序（`@deepseek-ai/dsh-base` 先，再按安装顺序）
2. profile 自己的 `cordis.patch.yml`
3. 机器级 `$DSH_HOME/cordis.patch.yml`
4. 每个 `--patch <path>` overlay（argv 顺序）

后果（见 [publish.md 加载顺序](./publish.md)）：你的 bundle 可以用同 `id` 覆盖前面层的行（如 `dsh-web-app` 覆盖 `dsh-base`），但要**重述该行所有需要的 key**，不能只写改动的那个。用户也能在 profile 层不改你包就覆盖你的行——所以优先给出用户大概率会保留的默认值，其余交给 schema 让用户覆盖。

## 六、跨 harness 兼容（可选扩展）

modlens 不只做 dsh 插件，还顺带做了 Claude Code / Codex / Pi / OpenCode 的 **skill**（`skills/modlens/`：SKILL.md + references/ + scripts/run.sh）。对 dsh 用户它强调：**装 plugin 而非 skill 文件夹**——只复制 skill 会丢失原生工具条目和 `(modlens vision)` 模型后缀。这是 plugin（原生工具 schema 每次请求都进模型上下文）比 prompt 触发 skill（靠触发词赌博）更稳的优势。如果你的目标用户跨多个 harness，可以照搬这个双形态策略。

## 七、开源作者检查清单

发版前逐条核对：

1. 包名 `type: module`，带 `dsh.bundle.patch` 清单，否则 `dsh plugin` 只当普通依赖，不激活。
2. `cordis.patch.yml` 用包名 insert，handler 入口零依赖、只用 Node 内置。
3. 工具名避开 host 已有名（如 `read_image`）；参数用原生 JSON Schema，自己在校验。
4. web-only 能力用 `ctx.inject` 函数式作用域包裹，headless 不受影响。
5. 配置默认值尽量给"用户会保留"的，其余交给 schema。
6. 发布 **pin 版本**（npm 优先），别用 `@latest`；git 分发需 `prepare` 自构建 + 引导用户 `allowBuilds`。
7. 失败 fail loud；注册错误降级而非拖垮整条能力链。
8. 资源一律走 `ctx.effect()` / 注册返回的 disposer，保证卸载干净。
9. 如需浏览器端，用 `dsh.client` + `./client` 入口，client 同样零依赖、无构建步骤。

## 下一步

- [打包与安装插件](./publish.md) — bundle 与 profile 的 manifest 细节
- [插件配置](./config.md) — `inject`、`!!js` 配置与覆盖机制
- [插件工具](./tool.md) — 工具的 JSON Schema 与 `output.render`
