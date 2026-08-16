# @deepseek-ai/dsh-vision

[English](README.md) | 中文

图片理解 pre-step 插件。它使用配置的视觉模型，描述即将进入 agent 步骤的用户消息所携带的图片，并将描述文本折叠回消息中，再写入会话日志。

与纯 OCR 引擎不同，视觉模型被要求**描述整张图片**：图中有可见文字则转写该文字，图中无文字则描述画面内容。系统提示词禁止编造图中不存在的文件名或说明文字，因此当图片没有文字时，下游（通常是纯文本）模型不会被喂入编造的占位文本。

插件挂在 `agent/pre-step` seam——唯一允许插件改写进入步骤消息的扩展点。因为描述文本成为进入的 `user/message` 会话事件的一部分，它对模型可见且可重建，满足 harness 的「Model-visible ⟺ logged」规则。这是注入图片理解结果的合规 seam：`llm/stream` 请求被深度冻结、不可改写，而 `llm/stream` 监听器会注入永远不会进入日志的内容。

## 路由与失败契约

视觉处理通过已注册的 `LlmRuntime` 作为普通子调用运行：`provider`/`model` 来自 `visionProvider`/`visionModel`，图像块原样转发（适配器从附件引用解析字节），`visionPrompt` 成为系统提示词。真实模型看不到该子调用，因此无需递归守卫。

当消息没有图像块时，pre-step 监听器原样返回 `next()`——零开销。当视觉模型没有产出可用文本时，由 `onFailure` 决定：`pass` 保留原图、`skip` 丢弃图片（仅 replace 模式；append 模式没有文本可追加）、`throw` 中止该步骤。

视觉预处理后，进入的消息用 `createUserMessage`（深度冻结）重建，保留原始 `source`，使描述仍是真实的 `user/message` 事件。在 `replace` 模式下，图像块被替换为携带描述的 `text` 块（以 `visionProvenance` 为前缀）；在 `append` 模式下，保留图像并在其后插入描述 `text` 块（无前缀）。

## 配置

每个字段都随部署变化。插件注册了一个 `dsh-vision` settings 段：cordis.yml 里的 entry `config`（或 base bundle）是 **base 层**，而 `settings.yaml`（或 Web UI）里的用户覆盖构成 **user 层**。当 settings 服务缺失时（例如不带 settings 提供方的 headless 运行），该段回退到 entry config，因此不会丢失配置。`visionProvider` / `visionModel` 带有 schema 默认值（`dashscope` / `qwen3.8-max`），所以空 base 也能通过校验；真实部署值来自 user 层。

| 键 | 契约 |
| --- | --- |
| `visionProvider` | 视觉引擎 provider 路由，复用已注册的 `LlmRuntime` 路由。可选；默认 `dashscope`。 |
| `visionModel` | 视觉引擎模型 id。可选；默认 `qwen3.8-max`。 |
| `visionPrompt` | 发给视觉模型的系统提示词。可选；合理默认要求忠实描述图片（有文字则转写、无文字则描述画面、绝不编造文件名）。 |
| `visionMaxTokens` | 发给视觉子调用的 `max_tokens` 上限。可选；不设置时请求不带 `max_tokens`，由视觉模型自身的输出上限决定（qwen3.8-max 为 128K）。对于长截图，若完整转写会在模型默认值处被截断，可设置此值抬高上限。必须为正整数且不超过视觉模型的输出上限。 |
| `visionProvenance` | 在 `replace` 模式下为描述文本添加的前缀，提示下游模型该文本来自图片。可选；默认 `[Image understanding]\n`；设为空字符串可关闭。 |
| `mode` | `replace` 用文本替换图片；`append` 保留图片并追加文本。可选；默认 `replace`。 |
| `enabled` | 总开关；为 `false` 时监听器原样透传消息。默认 `true`。 |
| `onFailure` | `pass` 保留图片、`throw` 中止、`skip` 在识别失败时丢弃图片。默认 `pass`。 |

### 通过 Web UI 编辑

「模型」设置页（由 `@deepseek-ai/dsh-client-ui-settings-models` 提供）渲染一张 **视觉理解** 卡片，背后就是 `dsh-vision` 命名空间。每个字段立即通过 wire 写入（`api.settings.mutate` 的 set/unset），因此改动会在**不重启**的情况下热生效到运行中的插件。被用户覆盖的字段显示琥珀色圆点；点其重置可单独 unset 回 base 层，「重置全部自定义」则清空所有覆盖。settings 段 hook 会在每次 attach/detach/commit 时更新 `VisionService.enabled` / `VisionService.mode`，因此 `agent/pre-step` 监听器与宿主图片准入始终读取最新值。

## 按模型选择是否预处理

`enabled` 是部署级总开关，决定 vision 插件是否挂载。但同一次部署里的不同模型，往往需要不同的图片处理策略——例如一个多模态主模型应当**原生看图**，而纯文本主模型才需要 vision 转文字。每个模型可在其目录条目（如 `DeepSeekCatalogModel`）声明 `vision` 三态标志，让 vision 的 `agent/pre-step` 在介入前按当前 agent 选用的模型决定：

- **`undefined`（未声明）**：按模型的 `inputModalities` 推断。多模态模型（含 `image`）默认**不介入**——它原生看图，无需被拖进 vision 预处理；纯文本模型默认**介入**。
- **`'on'`**：强制预处理，即使主模型是多模态的（面向想统一走某个视觉引擎的场景）。
- **`'off'`**：强制不介入，即使主模型是纯文本的（图片走宿主正常准入，不设 `imageAdmissionBypass`）。

`vision` 是 vision 插件内部的决策输入，不反向影响宿主的 `imageAdmissionBypass` 读取。`resolveVisionMode(vision, isMultimodal)` 是该推断的纯函数，行为见上表。当前 deepseek 与 pi-ai 两个 adapter 的模型目录条目都支持声明 `vision` 字段（`on` / `off`）；未声明时两者都从 `inputModalities` 推断，行为完全一致。

```yaml
# provider 目录里的模型条目（示例：deepseek adapter）
models:
  - id: deepseek-chat
    vision: off          # 若该模型已声明多模态，显式关闭预处理
  # - id: some-multimodal-model   # 未声明 vision → 默认不介入（原生看图）
```

> 三态而非布尔：`undefined` 保留了「按模态自动推断」这一默认解药，避免把多模态模型的默认行为锁死；`'on'`/`'off'` 提供显式覆盖。


## 用法

视觉插件**默认不挂载**。需将其加入 Cordis 配置并路由一个视觉模型后，才会影响进入的消息。插件通过 `ctx.get('vision')` 暴露能力。`agent/pre-step` 在决定介入后，仅对**纯文本主模型**设置 `agent.imageAdmissionBypass`（见 `packages/core/agent`）：由于图片在模型看到消息前已被移除，纯文本拒绝被绕过。多模态主模型凭自身 `inputModalities` 放行图片，从不读取该信号，也不会被设置 bypass。是否介入由 `enabled` 总开关叠加当前模型的 `vision` 标志（见上文「按模型选择是否预处理」）共同决定，而非无条件地为每个 agent 设 bypass。

### 1. 在 profile / patch 中挂载插件

将以下内容作为 `insert` 项加入你的 Cordis 配置（profile 的 `cordis.yml`，或用户级 patch 如 `~/.dsh/cordis.patch.yml`）。插件**不带 `config`**——部署值放在 `dsh-vision` settings 段（见「配置」）：

```yaml
- insert:
    - id: vision
      name: '@deepseek-ai/dsh-vision'
      # visionProvider / visionModel / mode / onFailure / ... 都在 settings.yaml 的 dsh-vision 段，
      # 或 Web UI「模型」页 →「视觉理解」卡片里。
```

`visionProvider` / `visionModel` 指向一个**具备视觉能力**的模型（即视觉引擎），它可与下游纯文本主模型不同。没有 settings 层时，schema 默认值（`dashscope` / `qwen3.8-max`）生效。

### 2. 启动并触发

```sh
pnpm dsh --profile web        # 启用 vision 的 profile
```

在 Web UI 中上传图片并发送。在 `agent/pre-step`，于消息写入日志之前：

1. 每张图片通过一次子调用描述，使用 `visionProvider`/`visionModel`（真实模型不可见）；
2. 描述按 `mode` 折叠回消息——`replace` 用 `[Image understanding]\n<text>` 替换图片，`append` 保留图片并追加描述文本块；
3. 重建的消息作为 `user/message` 会话事件记录，并对下游模型可见。

### 3. 确认 vision 已触发

- 会话日志 `~/.dsh/sessions/<cwd>/session-*/session.jsonl.zstd`：在步进的 `user/message` 中，图片块已消失（replace 模式），`content` 携带带 `[Image understanding]` 前缀的文本。
- 下游纯文本模型（例如适配器拒绝图像块的模型）收到文本而非 400——这证明 vision 替换生效。
- 用**真实图片**测试（照片 / 带文字截图 / 图表 / 一张完全没有文字的图）；无文字图正是 OCR 无法覆盖的场景——视觉模型应描述画面，而非编造文件名。

### 4. 常见场景

- **纯文本模型需要理解任何图片**：`mode: replace` + `visionProvenance` 前缀。主请求前图片被移除，纯文本模型拿到描述，避免「模型不支持图片」的 400。无文字图的描述是画面，有文字图的描述包含转写文字。
- **视觉模型也应看到图片**：`mode: append` 保留图片并在其后追加描述（主模型自身必须接受图像输入）。
- **描述失败不能阻断对话**：`onFailure: pass`（默认）保留图片；`skip` 丢弃图片且无文本；`throw` 中止该步骤。

> Vision 在消息提交时运行一次并持久化；改 `visionPrompt` / `visionModel` / `visionProvenance` 不会追溯影响已存在的会话——请在**新会话**中验证改动。

## 模型体验

### 经过 vision 预处理的进入消息

#### 模型看到的内容

真实模型在 pre-step 之后收到进入的用户消息：replace 模式下图片已消失，仅剩描述 `text` 块；append 模式下图像块后跟随描述 `text` 块。视觉子调用本身对真实模型不可见。

#### Token 影响

视觉处理为每张图片增加一个辅助描述请求（按图片大小与描述输出消耗 token），加上真实请求上注入的描述 token。描述每次消息提交运行一次后永久留在日志；后续的 `visionPrompt`/模型改动不会追溯影响已存在会话。

#### KV 缓存影响

视觉子调用不会使主请求失效。replace 模式下图片在主请求前被移除，因此具备视觉能力但 token 昂贵的图像处理被更便宜的文本替代，适用于纯文本模型。

## 已知限制与待办

- Vision 在消息提交时运行一次并永久记录，不会在后续步骤重跑，因此改 `visionPrompt` 或 `visionModel` 不会修订历史会话。在多模态模型下持久化进历史（其按模型推断拒绝了预处理）的图片，之后也无法回溯处理：宿主 `selectModel`/`prompt` 准入在派生历史残留图片时拒绝纯文本目标，并以 compaction 作为清理途径——见 atomic-web-image-admission 设计。
- `skip` 仅在 `replace` 模式下移除图片；`append` 模式下失败的图片被保留（没有文本可追加）。
- 图片准入豁免（`imageAdmissionBypass`）仅在 vision 实际介入且主模型为纯文本时设置；多模态主模型（`vision` 推断为不介入、或显式 `'off'`）不会触发预处理，也不设该信号，图片按宿主正常准入处理。`append` 模式下原图会留存到模型，纯文本主模型仍须拒绝该消息——这是正确的，因为模型会收到它读不了的图片。
- 插件原样将图像块转发给视觉引擎；模型是忠实转写文字还是描述画面由 prompt 契约约束，而非代码——违反 prompt 的视觉模型仍需改 prompt 或模型。
- Provider 特定的多图批处理、区域选择、语言提示当前未暴露，需作为视觉引擎的 `Config` 扩展。
- 本包不提供 keyless 快照；可通过带真实视觉能力 provider 的可运行 `cordis.yml` bundle 复现「用户发图 → 真实模型收到描述」。
