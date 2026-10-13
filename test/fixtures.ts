import example from '../examples/packs.example.json'
import { resolve } from '../src/resolve.js'
import type { AppState, Pack, ServerState } from '../src/types.js'
import type { DisabledTools } from '../src/validate.js'

/**
 * The packs under test are read from the example file, so the docs and the
 * tests can't drift apart.
 *
 * (`as unknown as` because TS widens each JSON object literal into its own
 * shape — with `undefined`s for the keys it happens not to have — which isn't
 * directly comparable to `Pack`. In a real client you'd validate the JSON
 * instead of casting it; here the tests are the validation.)
 */
export const packs = example.packs as unknown as Pack[]
export const disabled = example.disabled as DisabledTools

/**
 * Tool lists as a client would have cached them from `tools/list`.
 *
 * 🚨 Every tool starts `enable: true`. That's not an accident — it mirrors how
 * real MCP servers behave, and it's the reason the naive "turn the members on"
 * implementation silently does nothing. The actual gate is `attached`, not the
 * per-tool flag.
 */
const SERVER_TOOLS: Record<string, string[]> = {
  github: [
    'get_file',
    'search_code',
    'list_commits',
    'list_issues',
    'create_issue',
    'close_issue',
    'comment_issue',
    'create_pull_request',
    'review_pull_request',
    'merge_pull_request',
    'list_notifications',
    'mark_notification_read',
  ],
  filesystem: ['read_file', 'write_file', 'list_directory', 'move_file'],
  slack: ['list_channels', 'send_message', 'upload_file'],
  postgres: ['query', 'list_tables'],
}

export function makeServers(): ServerState[] {
  return Object.entries(SERVER_TOOLS).map(([name, tools]) => ({
    name,
    tools: tools.map((t) => ({ name: t, enable: true })),
  }))
}

/** A clean slate: the client knows about every server, but none is attached yet. */
export function freshState(): AppState {
  return { localTools: [], attached: [], servers: makeServers() }
}

export const ALL_SERVER_TOOLS = SERVER_TOOLS

/** Which tools are on for a given server. */
export function enabledOn(state: AppState, server: string): string[] {
  return state.servers
    .find((s) => s.name === server)!
    .tools.filter((t) => t.enable)
    .map((t) => t.name)
    .sort()
}

/** Apply a pack on/off, expecting it not to be blocked. */
export function apply(state: AppState, packId: string, enable: boolean): AppState {
  const r = resolve(state, packs, packId, enable)
  if (r.blocked) throw new Error(`unexpectedly blocked: ${JSON.stringify(r.blocked)}`)
  return r.state
}
