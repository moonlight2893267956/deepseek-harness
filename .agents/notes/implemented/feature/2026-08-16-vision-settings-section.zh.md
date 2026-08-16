# Agent Note: 视觉配置 UI（dsh-vision settings 段）

状态：已实现

[English](2026-08-16-vision-settings-section.md) | 中文

## 问题

Vision 部署配置（`visionProvider` / `visionModel` / `mode` / `onFailure` / `visionMaxTokens` / `visionPrompt` / `visionProvenance` / `enabled`）原本写在手编的 `~/.dsh/cordis.patch.yml` 里，作为静态 `insert` 的 `config`。修改它意味着要知道 YAML 结构、手敲可调参数并重启 host。插件还把已解析配置封在闭包里，即使通过 settings 改了，也不会到达 `agent/pre-step` 监听器（除非重载）。

## 决策

把插件接入 settings capability seam，完全参照 `llm-pi-ai`：`apply` 调用 `installSettingsSection(ctx, NS, Config, entry, { setSource, onChange })`，其中 `NS = settingsNamespace('dsh-vision')`，`entry` 是 cordis.yml 的 `config`（base 层）。user 层来自 `settings.yaml` / Web UI。当 settings 服务缺失（无提供方的 headless）时，该段回退到 `entry`，因此不会丢失配置。

`VisionService` 新增 `update(config)` 方法，刷新其 `config`、`enabled`、`mode` 字段。`agent/pre-step` 监听器不再读静态快照：它读活的 `vision.enabled` / `vision.mode`，`onChange` 在每次 attach/detach/commit 调用 `vision.update(source())`。因为 `enabled`/`mode` 是实时读取的，宿主的 `imageAdmissionBypass`（仅 `replace` 模式设置）与介入决策始终反映最新值，无需重启。

`visionProvider` / `visionModel` 现在带有 schema 默认值（`dashscope` / `qwen3.8-max`），所以空 base 也能通过校验；真实部署值来自 user 层。`mode` / `enabled` / `onFailure` 本就有默认。这使得 `~/.dsh/cordis.patch.yml` 可以完全去掉 vision 的 `config`——只保留插件 `insert` 行。

Web UI 在「模型」设置页（`@deepseek-ai/dsh-client-ui-settings-models`）渲染一张 **视觉理解** 卡片。它从共享的 `ModelsSettingsStore` 读取 `dsh-vision` 命名空间视图，渲染各字段，并立即通过 `api.settings.mutate`（`set`/`unset`）写入。空值用 `unset` 回退到 base 层，而非写入 `null`。被用户覆盖的字段显示琥珀色圆点；逐字段重置会 unset 该路径，「重置全部自定义」清空所有覆盖。store 在每次 settings 失效时重新 describe，因此表单实时反映外部修改。

## 验证

`packages/vision/vision/tests/settings.spec.ts` 固定了：user 层改动热更新 `vision.enabled` / `vision.mode` 而无需重启；detach 回退到 entry；插件卸载时命名空间注销；且无 settings 提供方时仍能挂载。`packages/client/ui-settings-models/tests/vision-section.client.spec.tsx` 固定了字段渲染、即时 `set`/`unset` 写入、覆盖圆点与重置、重置全部，以及被拒写入报错而不误报「已保存」。host 能以携带 `dsh-vision` 的 `~/.dsh/settings.yaml` 干净启动，且被服务的 client 插件模块包含该分区。

## 考虑过的替代方案

- **配置继续留在 cordis.patch.yml**——否决：那正是用户想不再手编的文件，且静态 `config` 无法热生效。
- **插件直接读 `settings.yaml`**——否决：它绕过了 settings seam 的 base/user/revision 契约、活的 `watch` 与 UI 的唯一写入路径；这块本就由 seam 负责。
- **把已解析配置放在可变插件局部字段、由 `watch` 监听器更新**——否决，改为由 section hook 驱动的 `VisionService.update`，使监听器与服务共享单一来源，且 hook 已在 attach/detach/commit 时运行。
- **`visionProvider`/`visionModel` 必填且无默认**——否决：那会强制每个 `cordis.patch.yml` 都带 `config`（与「去掉 config」目标冲突），并会让无 settings 层的 headless 启动失败。

## 影响

- Vision 配置在 Web UI 中编辑并持久化到 `~/.dsh/settings.yaml` 的 `dsh-vision`，热生效而无需重启 host。
- `~/.dsh/cordis.patch.yml` 只保留 vision 插件的 `insert` 行。
- schema 默认值意味着未配置的部署仍以 `dashscope` / `qwen3.8-max` 启动；Web UI 在被覆盖前把它们显示为继承值。
- 当已解析配置违反字段契约（例如非正的 `visionMaxTokens`）时，插件仍在加载时 loud 失败，保留「错误配置加载即失败」的规则。
