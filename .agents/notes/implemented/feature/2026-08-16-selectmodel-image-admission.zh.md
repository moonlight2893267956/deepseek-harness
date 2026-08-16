# Agent Note: selectModel 图片准入与已配置的 pre-step 保持一致

状态：已实现

[English](2026-08-16-selectmodel-image-admission.md) | 中文

## 问题

按模型启用 vision 的能力落地后，`LlmResolvedModelInfo.vision` 顺利走到了 vision pre-step，但宿主的 `selectModel` 校验仍然在「session 已经包含图片 + 目标模型是纯文本」时直接拒绝。复现：session 在多模态模型下接收过一张图，用户随后切到一个 `vision: 'on'` 的纯文本模型。`selectModel` 返回 `model-unavailable`，切换根本无法完成——而 vision pre-step 本来会在下一次 prompt 时把图片折叠成文本，并按副作用设上 `agent.imageAdmissionBypass`。用户没法选一个本来明显能用的模型。

根因：`selectModel` 只看 `agent.imageAdmissionBypass`（vision pre-step *跑过之后* 才写的 effect），完全不看已配置的 pre-step。`prompt` 准入路径正确地纳入了「OCR `enabled && mode === 'replace'`」，但也没看 vision 服务——这两条路径在「图片在模型看到前就被剥除」这件事上早已语义漂移。

修复时还顺手挖出一个潜在 bug：`LlmRuntime.resolveModelInfoFor` 在从 adapter 的 `resolveModel(...)` 结果构造 `LlmResolvedModelInfo` 时，把 `vision` 字段漏掉了，所以即使 `selectModel` 想看 vision，拿到的也是 `info.vision === undefined`。deepseek adapter 和目录模型条目本身是对的，是 runtime 那一层悄悄丢的。

## 决策

让两条图片准入路径都看「已配置的 pre-step 状态」，并把字段一路打通：

- 在 `packages/host/apiproxy/src/api-proxy.ts` 新增本地辅助函数 `imageStrippingPreStepConfigured(ctx, modelInfo)`。当 OCR pre-step 是 `enabled && mode === 'replace'`，或 vision pre-step 是 `enabled && mode === 'replace'` 且对目标模型 `resolveVisionMode(modelInfo.vision, isMultimodal).bypass` 为 `true` 时，返回 `true`。`selectModel` 与 `prompt` 准入都调用它；runtime effect `agent.imageAdmissionBypass` 在调用点做 OR 聚合，避免未来再有 effect 写入与静态检查漂移。
- `LlmRuntime.resolveModelInfoFor` 现在把 `resolved.vision` 透传到 `LlmResolvedModelInfo` 中，与其它能力字段（模态、上下文、max tokens、reasoning）保持一致。deepseek adapter 的 `modelInfo()` 与 `resolveModel()` 本身就已经正确，是 runtime 在漏。
- `apiproxy` 新增 `@deepseek-ai/dsh-vision` 作为运行时依赖（外加 `import { resolveVisionMode }`）和 `vision` 的 tsconfig reference，以及 type-only side-effect import 让 `ctx.get('vision')` 可解析。vision 服务是可选的，因此字段通过 `ctx.get` 读取，缺失时静默回退。

这个辅助函数是「已配置的 pre-step 是否会在这张图到达模型前把它剥掉」这个问题的单一真相源——`selectModel` 与 `prompt` 不会在准入判断上不一致。

## 范围修正：历史图片不可被剥除

后续 bug（pi-ai 对 `qwen3.7-max` 返回 400：从多模态模型切过来后）证明辅助函数的范围必须收窄到「进入中的图片」，而非「所有图片」。pre-step 只作用于**进入**步骤的消息——`agent/pre-step` 收到的是 claimed 的 inbox 消息，其 `enter` 决策被 append 进 session。已经持久化在 session 派生历史里的图片（例如多模态模型活跃时发送、vision 的按模型推断正确地拒绝预处理），在它们自己的入口处就被冻结，pre-step **无法回溯**。vision README 写明了这一契约：「Vision runs once at message submission and is logged permanently; it is not re-run on later steps.」

因此准入区分两种图片：

- **进入中的图片**（`selectModel` 的 `pendingImage`、`prompt` 的 `hasImage`）：已配置的 replace pre-step 会在模型调用前剥除，纯文本目标可以放行。
- **历史图片**（`messagesHaveImage(session.deriveMessages())`）：在自己的入口处已持久化，任何 pre-step 都够不到，compaction 是官方清理途径（`2026-07-29-atomic-web-image-admission.md`：「Compaction can make a text-only target valid once no pending or derived image remains」）。只要历史残留图片，纯文本目标就拒绝，即使 vision/OCR replace 已组合。

`selectModel` 与 `prompt` 准入都执行这一规则：`textOnly && (historyHasImage || !stripsEntering)` 即拒绝。错误消息把 compaction 列为修复手段，让拒绝可操作而不是死路。

## 为什么不直接 inline，而要抽辅助

两段一模一样的「OCR + vision」inline 检查，正是这次 bug 漂移的源头。抽一个本地辅助（一文件、两调用点、每点两行）让 lockstep 在结构上便宜。

## 改动面

| 位置 | 改动 |
| --- | --- |
| `packages/host/apiproxy/src/api-proxy.ts` | 新增 `imageStrippingPreStepConfigured(ctx, modelInfo)`。`selectModel` 与 `prompt` 准入都调用它。新增 `vision` side-effect import 与 `resolveVisionMode` value import。 |
| `packages/host/apiproxy/package.json` | 新增 `dependencies: @deepseek-ai/dsh-vision: workspace:^`。 |
| `packages/host/apiproxy/tsconfig.json` | 新增 `references: { path: '../../vision/vision' }`。 |
| `packages/llm/llm/src/index.ts` | `resolveModelInfoFor` 现在把 `resolved.vision` 拷贝进构造的 `LlmResolvedModelInfo`。 |
| `packages/host/apiproxy/tests/api-proxy-models.spec.ts` | 把现有拒绝用例的命名改成显式「无 image-stripping pre-step」的语义。补四个 `selectModel` 用例：vision replace 放行、OCR replace 放行、vision append 仍拒绝、目标模型 `vision: 'off'` 仍拒绝。新增 `registerVisionOffTextOnly` 辅助。 |

## 测试

- `api-proxy-models.spec.ts`（apiproxy）：18 / 18 通过。四个新增的 `selectModel` 准入用例与重命名的拒绝用例，把「`selectModel` 与 `prompt` 准入在图片剥除判断上的等价」固化下来。
- `vision/vision/tests`：21 / 21 通过。`LlmResolvedModelInfo.vision` 的新增透传不改变 vision 的每模型决策。
- `llm/llm/tests`：194 / 194 通过。透传是 LlmRuntime 唯一的改动，已被 apiproxy 新增用例覆盖；llm 包自身测试确认 `LlmAdapter` 契约无回退。
- `llm/llm-deepseek/tests`：151 / 151 通过。deepseek adapter 的 `modelInfo()` / `resolveModel()` 本来就已经带 `vision` 字段；runtime 透传只是把 adapter 已经在产出的东西重新暴露出来。
- 改动文件 oxlint 全部干净。

## 影响

- 用户可以从不含历史图片的 session 切到 `vision: 'on'` 的纯文本模型并发**新图**：准入看到已配置的 vision pre-step，直接放行；下一次 prompt 的 pre-step 按预期把进入的图片折叠成文本。
- **历史已含图片**的 session（多模态模型时代发的图）拒绝切换到纯文本：任何 pre-step 都无法回溯处理那些已持久化的块，错误消息指引 compaction 或选一个支持图片的模型。这与 atomic-web-image-admission 的设计一致。
- 同样的切换若配的是 `vision: 'off'`（或 vision 未启用，或 `mode: 'append'`）仍然拒绝——因为辅助函数读取的是静态配置，对应的 bypass 决策是 `false`。
- 两条准入路径现在共享同一个静态剥图决策与同一套历史图片策略；未来新增的 pre-step 只需要扩展 `imageStrippingPreStepConfigured` 一处，就能在切模型时与发消息时同时生效。
- `LlmResolvedModelInfo.vision` 现在对任何会 resolveModelInfo 的宿主都稳定可见，不再只有 vision pre-step 能拿到。
- pre-step 不再是「用户能选到某个模型」的隐含前提：准入直接看配置，所以模型选择 UI 不再依赖先前一次 prompt 的执行。
