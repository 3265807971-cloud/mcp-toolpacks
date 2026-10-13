import { unavailable } from './resolve.js'
import type { AppState, Pack } from './types.js'

/**
 * Tools that are deliberately off, with the server they live on.
 *
 * Shape: `{ [serverName]: [toolName, ...] }`.
 *
 * 🚨 **Keep a reason next to every entry, in code.** A tool nobody claims is
 * a tool that gets silently disabled the first time anyone touches a pack on
 * that server — and three months later nobody can tell whether it was a
 * decision or an oversight. This map exists so that "off" is *stated* rather
 * than *implied*.
 *
 * If you're tempted to add something here without writing down why: don't.
 */
export type DisabledTools = Record<string, string[]>

export interface ValidationReport {
  /**
   * Tools present on a server that **no pack claims** and that aren't listed
   * as deliberately off. These are the ones that will vanish without warning.
   * Should be empty.
   */
  unassigned: Record<string, string[]>
  /**
   * Tool names a pack references that the server doesn't have. Means the
   * cached tool list is stale, or someone renamed a tool server-side.
   */
  unavailable: Record<string, string[]>
  /**
   * Servers a pack names that don't exist at all. Almost always a rename or a
   * deletion, and it makes that pack **permanently un-onable** (see `isOn`),
   * so it's worth surfacing loudly in the UI rather than only in a log.
   */
  missingServers: Record<string, string[]>
}

/**
 * Health check for your pack table. Run it in tests (especially `unassigned`)
 * and, if you like, show `missingServers` in the UI.
 *
 * Why this matters more than it looks: the failure this catches is invisible.
 * A tool that's off when it should be on just means a feature mysteriously
 * doesn't work. A tool that's *on* when it should be off means you pay for it
 * in every single request, forever, and nothing tells you.
 */
export function validate(
  state: AppState,
  packs: Pack[],
  disabled: DisabledTools = {},
): ValidationReport {
  const claimed = new Map<string, Set<string>>()
  const claim = (server: string, tools: string[]) => {
    const set = claimed.get(server) ?? new Set<string>()
    for (const t of tools) set.add(t)
    claimed.set(server, set)
  }

  for (const pack of packs) {
    for (const [server, tools] of Object.entries(pack.mcpTools ?? {})) claim(server, tools)
  }
  for (const [server, tools] of Object.entries(disabled)) claim(server, tools)

  const unassigned: Record<string, string[]> = {}
  for (const server of state.servers) {
    const owned = claimed.get(server.name)
    const loose = server.tools.map((t) => t.name).filter((n) => !owned?.has(n))
    if (loose.length > 0) unassigned[server.name] = loose
  }

  const unavailableMap = new Map<string, Set<string>>()
  const missingServers = new Map<string, Set<string>>()

  const addAll = (into: Map<string, Set<string>>, server: string, tools: string[]) => {
    const set = into.get(server) ?? new Set<string>()
    for (const t of tools) set.add(t)
    into.set(server, set)
  }

  for (const pack of packs) {
    for (const { server, missing } of unavailable(state, pack)) {
      addAll(unavailableMap, server, missing)
    }
    for (const [server, tools] of Object.entries(pack.mcpTools ?? {})) {
      if (state.servers.some((s) => s.name === server)) continue
      addAll(missingServers, server, tools)
    }
  }

  return {
    unassigned,
    unavailable: toObject(unavailableMap),
    missingServers: toObject(missingServers),
  }
}

function toObject(m: Map<string, Set<string>>): Record<string, string[]> {
  return Object.fromEntries([...m].map(([k, v]) => [k, [...v]]))
}
