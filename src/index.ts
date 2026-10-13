/**
 * mcp-toolpacks — group MCP tools by purpose, not by server.
 *
 * Everything here is plain data in, plain data out. No framework, no
 * dependencies, no global state. Port `resolve()` to whatever language your
 * client is written in; it's about eighty lines and the comments explain every
 * branch.
 */

export { findServer, isOn, resolve, unavailable } from './resolve.js'
export { validate } from './validate.js'

export type { DisabledTools, ValidationReport } from './validate.js'
export type {
  AppState,
  Blocked,
  Pack,
  ResolveResult,
  ServerState,
  ToolState,
} from './types.js'
