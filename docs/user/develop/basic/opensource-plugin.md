# Open-source plugin development conventions

[中文](opensource-plugin.zh.md) | English

This guide uses the real open-source dsh plugin [modlens](https://github.com/liustack/modlens) (a vision bridge that lets text-only models "see" images) as a worked example. It collects the rules scattered across [Package and install](./publish.md), [Plugin configuration](./config.md), and [Plugin tools](./tool.md) into one set of conventions aimed at **out-of-tree plugins you publish for other people to install**. It assumes you have already read the basic tutorials.

dsh's runtime philosophy is **everything is a plugin**: a plugin is a Cordis module exporting `apply(ctx)`. The framework calls it at load time, and the plugin registers capabilities (tools, services, events, routes) through `ctx`. This guide answers "how do I turn a plugin into a package other people can `dsh plugin add`?"

## 1. Two plugin shapes

### Shape 1: local dev plugin (`--patch` overlay)
The fastest debugging path. Write `.ts` directly and insert it by absolute path in `cordis.yml` / `cordis.patch.yml`:

```yaml
- insert:
    - id: hello
      name: '/abs/path/to/my-plugin.ts'
```

Launch: `pnpm dsh web --patch ./scratch-plugin/cordis.yml`. Good for iteration, but produces no distributable artifact.

### Shape 2: distributable bundle (the open-source standard)
The shape you publish for others. It is an npm package carrying a `dsh.bundle` manifest. All conventions below target this shape.

## 2. Bundle layout and manifest

Following modlens, aligned with official [publish.md](./publish.md):

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

### `package.json` key fields (modlens, real config)

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

- `dsh.bundle.patch` points at the patch file — **a package without this declaration installs but activates no layer**, only as a plain dependency.
- `dsh.client` describes the browser half: which `platform` (web) it injects into, and whether `immediately`.
- Field meanings are in [publish.md](./publish.md)'s "Two concepts, two manifests".

### `cordis.patch.yml` (modlens, real content)

```yaml
- insert:
    - id: modlens
      name: '@liustack/modlens'
```

The patch row references the **package name**, not a path, so Node resolution finds the installed code (unlike local `--patch` absolute paths). Without a `dsh.bundle` declaration, `dsh plugin` treats the package as a plain dependency and activates no layer.

## 3. Entry-point coding conventions (`dsh/index.js`)

### Basic skeleton

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'modlens'
export const inject = ['tools', 'agents', 'attachments', 'llm']  // declare dependency services

export function apply(ctx: Context, config = {}) {
  // register disposables via ctx.effect()
}
```

### Required conventions (confirmed by modlens)

1. **Declare dependencies with `inject`**: the framework waits for these services (`tools` registry, `llm`, `attachments`, …) before loading your plugin. Omitting a declaration yields `undefined` injections and silent failure.

2. **Register through `ctx`, and stay disposable**: `ctx.tools.register(...)` etc. return a disposer bound to the plugin automatically; unload unregisters. Route every long-lived resource through `ctx.effect()` so teardown is clean.

3. **Zero-dep stance (critical)**: the handler uses only Node built-ins (`node:child_process`, `node:fs`, …) and **imports no dsh internal packages**. modlens states plainly "Registered as a raw JSON-Schema tool definition (no dsh package imports)" — because resolving `@deepseek-ai/dsh-*` packages out-of-tree is still unreliable. Put real engine logic in `src/` with its own build; the handler only orchestrates.

4. **Define tools with raw JSON Schema**, validating arguments yourself. Write `parameters` and `output` as JSON Schema directly instead of relying on the host's type system:

```ts
const tool = {
  name: 'modlens_read_image',
  description: '...',
  parameters: { type: 'object', properties: { path: {...}, prompt: {...} }, required: ['path'] },
  output: { schema: OUTPUT_SCHEMA, render: (_args, value) => [...] },
  async execute(args) { /* spawn local CLI engine */ }
}
```

   - **Avoid host-builtin tool names** (e.g. the host ships `read_image`, so use `modlens_read_image`). This is modlens's lesson from issue #34: a name clash confuses the model or collides.
   - `output.render` is a pure function; write it per the UI-render intent (`generic`/`terminal`/`diff`, …) in [adding-a-tool](../../../cookbook/adding-a-tool.md).

5. **Guard conditional capabilities with `ctx.inject` functional scope**: web-only routes (paste-to-path, settings card) are wrapped in `ctx.inject(['webServer'], scope => { ... })`. Under the headless profile `webServer` is absent, so that code never runs — instead of awaiting `webServer` in `apply` and stalling headless boot.

6. **Fail loud**: any registration error is `console.error`'d and degraded, rather than silently taking down the whole capability chain. modlens established this in issue #21: one vision-wrapper registration failure must not silently disable the whole plugin.

## 4. Two-sided plugins (web profile)

A web-profile plugin has **two halves**:

- **handler half** (`dsh/index.js`, Node side): registers tools, serves routes like `/modlens/paste`, and `ctx.inject(['webServer'], ...)` to provide browser callbacks.
- **client half** (`dsh/client.js`, browser side): hand-written as a lazy-loaded CJS protocol `window.__ModuleLoader__.load({ id, factory })`, **no build step, no dsh client package import**. Same zero-dep stance as the handler. modlens uses it to intercept image paste and inject a path string into the composer.

`package.json` exposes both entry points via `exports` (`.` and `./client`) and declares `dsh.client` so the framework knows where to inject `./client`.

## 5. Distribution and install (the open-source essentials)

### Install command (for your users)

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modlens@3.18.2
```

- `--profile web`: install into the web profile.
- **Pin a version, never `@latest`**: modlens's INSTALL.md warns explicitly that pnpm 11 withholds packages published in the last 24 hours, so an `@latest` install can silently pull an older build that errors with `declares no dsh.bundle`. A pinned version is treated by pnpm as an explicit request.
- Restart dsh after install; the `(modlens vision)` suffix in the model selector signals activation.

### Three distribution methods (official [publish.md](./publish.md) comparison)

| Method | Command | Build-permission requirement |
|---|---|---|
| npm publish (recommended) | `dsh plugin add <pkg>` | none (installs prebuilt `lib/`) |
| git install | `dsh plugin add github:you/repo#<sha>` | user must add `allowBuilds` in `pnpm-workspace.yaml` to permit the `prepare` script build |
| offline tarball | `dsh plugin add ./pkg-0.1.0.tgz` | none |

**The git-install trap (read carefully)**: it fetches sources, not built artifacts, so the author must ship a `prepare` script that builds from `src/` self-contained (no monorepo dev context), or a TS package arrives without `lib/` and fails to load. Asking the user for `allowBuilds` is, in effect, "permission to execute this package's code on your machine at install time" — always pin a commit so later pushes cannot silently change what runs. See [publish.md "Installing from GitHub"](./publish.md).

### Layer loading order (determines overrides)

The effective config composes in order; later layers win per `id` and a patch replaces a row's entire `config` (not a deep merge):

1. profile's `dsh.profile.bundles` list order (`@deepseek-ai/dsh-base` first, then by install order)
2. the profile's own `cordis.patch.yml`
3. machine-level `$DSH_HOME/cordis.patch.yml`
4. each `--patch <path>` overlay (argv order)

Consequences (see [publish.md loading order](./publish.md)): your bundle can override earlier rows by `id` (as `dsh-web-app` overrides `dsh-base`), but you must **restate every key the row needs**, not just the changed one. Users can also override your rows in their profile layer without touching your package — so prefer defaults users are likely to keep and let the schema carry the rest.

## 6. Cross-harness compatibility (optional extension)

modlens ships not only a dsh plugin but also **skills** for Claude Code / Codex / Pi / OpenCode (`skills/modlens/`: SKILL.md + references/ + scripts/run.sh). It tells dsh users: **install the plugin, not the skill folder** — copying just the skill drops the native tool entry and the `(modlens vision)` model suffix. A native tool schema enters model context on every request; a prompt-triggered skill gambles on trigger words. If your users span multiple harnesses, copy this dual-shape strategy.

## 7. Open-source author checklist

Verify before release:

1. Package is `type: module` and declares `dsh.bundle.patch`, else `dsh plugin` treats it as a plain dependency and never activates.
2. `cordis.patch.yml` inserts by package name; the handler is zero-dep and uses only Node built-ins.
3. Tool names avoid host-builtins (e.g. `read_image`); parameters are raw JSON Schema you validate yourself.
4. Web-only capabilities are wrapped in `ctx.inject` functional scope, unaffected under headless.
5. Defaults are values users will likely keep; the schema carries the rest.
6. **Pin a version** for release (npm preferred), never `@latest`; git distribution needs a self-contained `prepare` build plus guiding users to `allowBuilds`.
7. Fail loud; degrade on registration errors rather than taking down the whole chain.
8. Route every resource through `ctx.effect()` / the returned disposer for clean teardown.
9. If you need a browser side, use `dsh.client` + the `./client` entry, also zero-dep and build-free.

## Next steps

- [Package and install a plugin](./publish.md) — bundle vs profile manifest details
- [Plugin configuration](./config.md) — `inject`, `!!js` config, and override mechanics
- [Plugin tools](./tool.md) — tool JSON Schema and `output.render`
