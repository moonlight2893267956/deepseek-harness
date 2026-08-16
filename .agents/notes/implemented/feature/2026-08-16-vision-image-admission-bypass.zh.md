# Agent Note：面向纯文本模型的 vision 图片准入豁免

状态：已实现

[English](2026-08-16-vision-image-admission-bypass.md) | 中文

## 问题

纯文本模型（如 `deepseek-v4`）声明 `inputModalities: ['text']`。`packages/host/apiproxy/src/api-proxy.ts`
的宿主图片准入会在 **`agent/pre-step` 瀑布运行之前** 就拒绝带图片的输入。由于 vision 预处理（把图片转成文本）
位于准入的下游，图片在门口就被拒，vision 插件根本没机会剥离它们——用户看到"当前模型不支持图片"。

考虑过两个错误修复并放弃：

- **把 vision 模型声明为多模态**（`inputModalities: ['text','image']`）：这是不实的能力声明。负能力信号本就用于让宿主在序列化之前提前拒绝图片；谎报会让没有 vision 的会话也接受图片并最终出错。已回退。
- **无条件让所有模型走 vision**：这混淆了多模态与纯文本模型。多模态模型（如 `qwen-vl`）本就接受图片、应当原样查看；强行对它做 vision 改写既浪费一轮调用又丢失图片保真度。

## 决策

保持模型能力声明诚实，让"图片改写型 pre-step"针对**特定 agent** 豁免纯文本拒绝。契约如下：

- `packages/core/agent/src/runtime-types.ts` 给 `Agent` 接口新增可选字段 `imageAdmissionBypass?: true`。
  它是只读的宿主准入信号，仅由 pre-step 插件设置，绝不来自模型目录。
- `packages/vision/vision/src/index.ts` 在 `enabled && mode === 'replace'` 时，通过 `agent/created`
  的 effect 给每个 agent 设置该字段：replace 模式下图片在模型看到消息前已被移除，准入安全。
- `packages/host/apiproxy/src/api-proxy.ts` 在 `selectModel` 与 `prompt` 两处准入点，当
  `info.inputModalities.includes('image')` **或** `agent.imageAdmissionBypass === true` 时放行图片。
  OCR pre-step（`ctx.get('ocr')`）保留原有豁免以保持对等；两条 seam 互相独立，任一即可放行。

多模态模型仍凭自身 `inputModalities` 放行、从不读取 `imageAdmissionBypass`；无改写 pre-step 的纯文本模型
依旧被拒。区分得到保留。

## 改动面

| 表面 | 职责 |
| --- | --- |
| `packages/core/agent/src/runtime-types.ts` | `Agent.imageAdmissionBypass?: true` 可合并扩展信号。 |
| `packages/vision/vision/src/index.ts` | 当 `enabled && mode === 'replace'` 时在 `agent/created` 设置 `imageAdmissionBypass`。 |
| `packages/host/apiproxy/src/api-proxy.ts` | `selectModel` 与 `prompt` 准入在信号置位时绕过纯文本拒绝。 |

## 测试

- `packages/host/apiproxy/tests/api-proxy-models.spec.ts` 新增两例：纯文本模型在 `agent.imageAdmissionBypass`
  置位时（vision `replace` 路径）放行 prompt 图片；既无 OCR seam 又无 bypass 时仍拒绝图片。原有 OCR
  `replace` 准入用例不变。

## 后果

- vision `replace` 现在能在纯文本模型上端到端工作，且无需谎报能力。
- `append` 模式**不**设置 bypass：append 下原图会留存到模型，纯文本模型仍应拒绝它（正确——模型会收到它
  读不了的图片）。
- OCR 与 vision 两种 bypass 共存；统一到单一 seam 是后续清理，非正确性所需。
