# @deepseek-ai/dsh-ocr

[English](README.md) | 中文

图片 OCR 预处理插件。它在用户消息即将进入 agent 步骤时，用配置好的视觉模型识别其中的图片，并在消息写入会话日志之前把识别文本回填进消息。

插件挂载在 `agent/pre-step` 接缝上——这是插件唯一可以改写"进入步骤的消息"的位置。由于识别文本成为进入步骤的 `user/message` 会话事件的一部分，它既对模型可见、又可从日志重建，满足仓库的 "Model-visible ⟺ logged" 规则。这也是注入 OCR 输出的正规接缝：`llm/stream` 的请求是深度冻结的、不可改写，且 `llm/stream` 监听器注入的内容永远不会进入日志。

## 路由与失败契约

OCR 通过已注册的 `LlmRuntime` 作为一次普通子调用发起：`provider`/`model` 来自 `ocrProvider`/`ocrModel`，image 块原样转发（适配器从附件引用解析字节），`ocrPrompt` 作为系统提示词。真实模型看不到这次子调用，因此无需防递归保护。

消息不含 image 块时，pre-step 监听器直接 `next()` 放行——零开销。OCR 未产出可用文本时，由 `onFailure` 决定：`pass` 保留原图，`skip` 丢弃该图（仅 replace 模式；append 模式无文本可追加），`throw` 中止该步骤。

OCR 完成后，进入步骤的消息用 `createUserMessage`（深度冻结）重建：replace 模式把 image 块替换为 `text` 块；append 模式保留 image 并在其后插入一个携带识别文本的 `text` 块。注入文本的 `source.kind` 为 `'plugin'`（`plugin: 'dsh-ocr'`、`form: 'notice'`），以区分 OCR 产出与原始 user 图片。

## 配置

每个字段都随部署变化并在加载时校验；缺失必填项会 loud fail。

| Key | Contract |
|---|---|
| `ocrProvider` | OCR 引擎 provider 路由，复用已注册 `LlmRuntime` 路由。必填。 |
| `ocrModel` | OCR 引擎 model id。必填。 |
| `ocrPrompt` | 发给 OCR 模型的系统提示词。可选；默认要求逐字输出纯文本。 |
| `ocrProvenance` | `replace` 模式下拼接在识别文本前的前缀，提示下游模型"这段来自图片"。可选；默认 `[Image OCR result]\n`，设为空字符串关闭。 |
| `mode` | `replace` 把图片换成文本；`append` 保留图片并追加文本。必填。 |
| `enabled` | 总开关；`false` 时监听器直接放行。默认 `true`。 |
| `onFailure` | 识别失败时 `pass` 保留原图、`throw` 中止、`skip` 丢弃该图。默认 `pass`。 |

## 使用

OCR 插件默认**不挂载**，需要在一个 Cordis 配置里把它加进插件树并配置好视觉模型路由，才会对进入的消息生效。插件通过 `ctx.get('ocr')` 暴露能力；宿主侧（如 `apiproxy`）读取 `ocr.enabled` / `ocr.mode` 来决定上传门是否对纯文本主模型放行图片。

### 1. 在 profile / patch 里挂载插件

把下面这段作为一条 `insert` 加到你的 Cordis 配置（profile 的 `cordis.yml` 或用户级 patch，例如 `~/.dsh/cordis.patch.yml`）：

```yaml
- insert:
    - id: ocr
      name: '@deepseek-ai/dsh-ocr'
      config:
        ocrProvider: dashscope        # 复用已注册 LlmRuntime 的 provider 路由
        ocrModel: qwen3.7-plus        # 具备视觉能力的模型（OCR 引擎）
        mode: replace                 # replace | append
        onFailure: pass               # pass | skip | throw
        # ocrPrompt: 自定义系统提示词（可选）
        # ocrProvenance: '图片 OCR 识别结果：\n'   # 自定义前缀（可选）
```

`ocrProvider` / `ocrModel` 指向一个**具备视觉能力**的模型（OCR 引擎），与下游纯文本主模型可以不同。配置在加载时校验，缺 `ocrProvider` / `ocrModel` / `mode` 会直接 fail。

### 2. 启动并触发

```sh
pnpm dsh --profile web        # 启用 OCR 的 profile
```

在网页里上传图片并发送即可。`agent/pre-step` 会在消息写盘前：

1. 用 `ocrProvider`/`ocrModel` 对每张图发起一次识别子调用（真实模型看不到这次子调用）；
2. 把识别文本按 `mode` 折回消息——`replace` 用 `[Image OCR result]\n<识别文本>` 替换原图，`append` 保留原图并在其后追加文本块；
3. 重建后的消息作为 `user/message` 会话事件写盘，对下游模型可见。

### 3. 如何确认 OCR 生效

- 看会话日志 `~/.dsh/sessions/<cwd>/session-*/session.jsonl.zstd`：进入步的 `user/message` 里原 image 块应消失（replace 模式），`content` 中出现 `[Image OCR result]` 前缀的识别文本。
- 下游纯文本模型（如 `qwen3.7-max`，其适配器会拒绝 image 块）能正常收到文本而不报 400，即说明 OCR 替换生效。
- 用**真实图片**（照片 / 带文字的截图 / 流程图）测试，比终端截图更能直观验证：模型会基于识别文本回答画面内容。

### 4. 常见场景

- **给纯文本模型加 OCR 层**：`mode: replace` + `ocrProvenance` 前缀。图片在主请求前被移除，纯文本模型只收文字，避免"模型不支持图片"的 400。
- **视觉模型也想看原图**：`mode: append`，原图保留、同时在后面追加识别文本（此时主模型需本身支持 image 输入）。
- **识别失败不阻断对话**：`onFailure: pass`（默认）保留原图；`skip` 丢弃无文本图片；`throw` 直接中止该步。

> 注意：OCR 在消息提交时运行一次并永久落库；更换 `ocrPrompt` / `ocrModel` / `ocrProvenance` 不会回溯影响已有会话，需在**新会话**里验证改动。

## 模型体验

### OCR 预处理后的进入消息

#### 模型看到什么

真实模型收到 pre-step 之后的进入用户消息：replace 模式下图片消失、只剩识别出的 `text` 块；append 模式下 image 块之后紧跟一个 plugin-source 的 `text` 块（携带识别文本）。OCR 子调用本身对真实模型不可见。

#### token 影响

OCR 对每张图片增加一次辅助识别请求（按图片大小与 OCR 输出消耗 token），并在真实请求上增加注入文本 token。识别在消息提交时运行一次并永久写入日志；之后修改 `ocrPrompt`/模型不会回溯影响已有会话。

#### KV Cache 影响

OCR 子调用不会使主请求缓存失效。replace 模式在真实请求前移除图片，因此图片处理（对纯文本模型如 DeepSeek 的适配器会拒绝 image 块而言是必须的）被更便宜的文本替代。

## 已知限制与待办

- OCR 在消息提交时运行一次并永久落库；不会在后续步骤重跑，因此修改 `ocrPrompt` 或 `ocrModel` 不会修订历史会话。
- `skip` 仅在 replace 模式移除图片；append 模式下识别失败的图片会被保留（没有文本可追加）。
- 插件将原样 image 块转发给 OCR 引擎；provider 特定的多图批处理、区域选择、语言提示目前未暴露，需作为 OCR 引擎的 `Config` 扩展。
- 本包不附带 keyless 快照；可通过可运行 `cordis.yml` bundle + 真实 OCR 能力 provider 复现"用户发图 → 真实模型收到 OCR 文本"。
