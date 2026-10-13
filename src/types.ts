/**
 * The whole data model. Deliberately plain — no classes, no framework types,
 * no IDs you have to mint. If your client already has a richer model
 * (a database row, a Zustand store, a Compose state holder), write a small
 * adapter into `AppState` and everything in this repo works unchanged.
 */

/**
 * A pack: a purpose-named group of tool references, with one switch.
 *
 * The name is the point. MCP servers are packaged by *vendor*; a pack is
 * packaged by *what you're doing right now*.
 */
export interface Pack {
  /** Stable identifier. Also what you'd persist as "which packs are on". */
  id: string
  /** The big line on the card. */
  title: string
  /** One line of small text under it. */
  desc?: string
  /** Optional footnote shown only when the card is expanded. */
  note?: string
  /**
   * Tools your *client* provides (not from any MCP server). Optional —
   * leave it out entirely if you don't have client-side tools.
   */
  localTools?: string[]
  /**
   * Server name → the tool names from *that* server this pack wants on.
   *
   * ⚠️ Only list what should be ON. Referencing a tool by name (rather than
   * by server) is the whole trick: it lets one pack reach into a server that
   * bundles five unrelated things, without dragging the other four along.
   */
  mcpTools?: Record<string, string[]>
}

export interface ToolState {
  name: string
  enable: boolean
}

export interface ServerState {
  /**
   * Servers are addressed by name, because names are what packs reference.
   * If your client keys servers by UUID, keep that in your own model and
   * map name → id in the adapter.
   *
   * 🚨 Renaming a server silently breaks every pack that mentions it.
   * See `validate()` — it reports these so you can surface them in the UI.
   */
  name: string
  tools: ToolState[]
}

/** The complete state of "what can this assistant currently reach". */
export interface AppState {
  /** Client-side tools that are currently on. */
  localTools: string[]
  /** Names of the servers currently attached to this assistant. */
  attached: string[]
  /**
   * Every server the client knows about, with its tools.
   *
   * Note this is the *cached* tool list, not a live one. It's whatever you
   * last got from `tools/list`. Staleness here is the cause of the single
   * nastiest failure mode in this whole repo — see `resolve()`.
   */
  servers: ServerState[]
}

/** A pack references tool names that the server doesn't have. */
export interface Blocked {
  server: string
  missing: string[]
}

export interface ResolveResult {
  /** The new state. On `blocked`, this is the input state, untouched. */
  state: AppState
  /**
   * Non-empty means **nothing was changed** and the caller should sync the
   * tool list and try again, or tell the user why it can't.
   */
  blocked?: Blocked[]
}
