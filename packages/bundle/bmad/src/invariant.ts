/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-bmad`.
 * @module @deepseek-ai/dsh-bmad/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-bmad'

/** Cordis companion plugin name. */
export const name = 'bmad-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider registers read-only prompt variables
 * from a static TOML file and the customize tool resolves TOML on demand.
 * Neither holds mutable state or a durable event/data relation to audit
 * inside the tree; BMAD's absence is valid empty state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
