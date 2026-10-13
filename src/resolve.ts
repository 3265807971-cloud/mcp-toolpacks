import type { AppState, Blocked, Pack, ResolveResult, ServerState } from './types.js'

const localOf = (pack: Pack): string[] => pack.localTools ?? []
const mcpOf = (pack: Pack): Record<string, string[]> => pack.mcpTools ?? {}

/** Find a server by name. Returns undefined if it's been renamed or removed. */
export function findServer(state: AppState, name: string): ServerState | undefined {
  return state.servers.find((s) => s.name === name)
}

/**
 * Is this pack currently on?
 *
 * **Computed, never stored.** A pack is on iff every one of its members is on.
 *
 * Storing a boolean next to the switch is how you end up with "the toggle
 * says on but it's actually off" — and you will only find out months later,
 * from a bill. Derive it instead and that class of bug can't exist.
 *
 * ⚠️ Deliberately per-pack: if the same server carries two packs (say a
 * "reading" pack and a "coding" pack that both want `filesystem::read_file`),
 * both report as on. They don't fight over the shared tool.
 */
export function isOn(state: AppState, pack: Pack): boolean {
  const wantLocal = localOf(pack)
  if (!wantLocal.every((t) => state.localTools.includes(t))) return false

  for (const [serverName, wanted] of Object.entries(mcpOf(pack))) {
    const server = findServer(state, serverName)
    // Server gone (renamed/removed) → the pack cannot be on. `validate()`
    // reports these separately so you can tell the user *why*.
    if (!server) return false
    if (!state.attached.includes(serverName)) return false

    const enabled = new Set(server.tools.filter((t) => t.enable).map((t) => t.name))
    if (!wanted.every((w) => enabled.has(w))) return false
  }
  return true
}

/**
 * Which tools does this pack reference that the server doesn't have?
 *
 * Non-empty means your cached tool list is stale — the server added tools
 * (or renamed them) since you last synced.
 *
 * A server the pack names but that doesn't exist at all is *not* reported
 * here; that's a different problem with a different fix. See `validate()`.
 */
export function unavailable(state: AppState, pack: Pack): Blocked[] {
  const out: Blocked[] = []
  for (const [serverName, wanted] of Object.entries(mcpOf(pack))) {
    const server = findServer(state, serverName)
    if (!server) continue
    const have = new Set(server.tools.map((t) => t.name))
    const missing = wanted.filter((w) => !have.has(w))
    if (missing.length > 0) out.push({ server: serverName, missing })
  }
  return out
}

/**
 * Turn a pack on or off. Returns a **complete new AppState** — never mutates,
 * never writes half of it.
 *
 * ## The algorithm
 *
 * The obvious implementation — "on: enable the members; off: disable the
 * members" — is wrong, and wrong in a way you won't notice for weeks.
 *
 * The reason: servers usually ship with every tool enabled by default and the
 * real switch is whether the server is attached at all. So "enable the
 * members" re-enables things that were already enabled and changes nothing:
 * turn on your "email" pack and you also get the fishing minigame, because
 * they live on the same server and both were already `enable: true`.
 *
 * The correct rule is to reason about the *outcome*, not the delta:
 *
 *   1. Work out which packs are on *after* this change.
 *   2. Look only at the servers *this* pack names. Leave every other server
 *      alone — turning on a pack must not disable somebody else's server.
 *   3. For each of those servers: the tools that should be on are the **union**
 *      of the members of every open pack that touches this server. Everything
 *      else goes off.
 *   4. A server left with zero enabled tools gets detached. A server attached
 *      with nothing on is dead weight — most clients will filter it out anyway.
 *
 * Consequence worth internalising, because it surprises people: because step 3
 * **overwrites by union**, a tool on one of these servers that no pack claims
 * gets forced off. If a user hand-enabled something in a separate settings
 * screen, touching any pack on that server wipes it. That's intentional
 * (off is the default) but it means **every tool must be claimed by some pack
 * or listed as deliberately off** — `validate()` exists to enforce exactly that.
 */
export function resolve(
  state: AppState,
  packs: Pack[],
  packId: string,
  enable: boolean,
): ResolveResult {
  const pack = packs.find((p) => p.id === packId)
  if (!pack) throw new Error(`Unknown pack: ${packId}`)

  // ── Guard: refuse to do anything if the pack references tools we can't see ──
  //
  // 🚨 This is the difference between "the switch didn't work" and "the whole
  //    server silently went dark".
  //
  // The union algorithm below matches on *names only*. If not a single name
  // matches — because the server registered new tools and this client hasn't
  // synced yet — `desired` comes out empty, so every tool on that server gets
  // disabled and the server itself gets detached. The user sees a switch that
  // does nothing. What actually happened is that every feature on that server
  // just stopped, mid-conversation.
  //
  // Refusing to move is always the lesser harm: nothing is lost, and the caller
  // can sync and retry.
  //
  // Only guarded on the way in. Turning a pack *off* must always be possible —
  // that's the escape hatch if a server later drops a tool for good.
  if (enable) {
    const missing = unavailable(state, pack)
    if (missing.length > 0) return { state, blocked: missing }
  }

  const packLocal = localOf(pack)
  const localTools = enable
    ? [...new Set([...state.localTools, ...packLocal])]
    : state.localTools.filter((t) => !packLocal.includes(t))

  // 1. Which packs are on after this change?
  const openPacks = new Set(packs.filter((p) => isOn(state, p)))
  if (enable) openPacks.add(pack)
  else openPacks.delete(pack)

  // 2 & 3. Touch only the servers this pack names; set each by union.
  const touched = new Set(Object.keys(mcpOf(pack)))
  const servers = state.servers.map((server) => {
    if (!touched.has(server.name)) return server

    const desired = new Set(
      [...openPacks]
        .filter((p) => server.name in mcpOf(p))
        .flatMap((p) => mcpOf(p)[server.name] ?? []),
    )
    return {
      ...server,
      tools: server.tools.map((t) =>
        t.enable === desired.has(t.name) ? t : { ...t, enable: desired.has(t.name) },
      ),
    }
  })

  // 4. Detach servers left with nothing on.
  const attached = new Set(state.attached)
  for (const name of touched) {
    const server = servers.find((s) => s.name === name)
    if (!server) continue
    if (server.tools.some((t) => t.enable)) attached.add(name)
    else attached.delete(name)
  }

  return { state: { localTools, attached: [...attached], servers } }
}
