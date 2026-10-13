import { describe, expect, it } from 'vitest'

import { isOn, resolve, unavailable } from '../src/resolve.js'
import { validate } from '../src/validate.js'
import type { AppState, Pack } from '../src/types.js'
import { ALL_SERVER_TOOLS, apply, disabled, enabledOn, freshState, packs } from './fixtures.js'

const packOf = (id: string): Pack => packs.find((p) => p.id === id)!

// ══════════════════════════════════════════════════════════════════════════
//  Why these tests exist
//
//  Every failure mode in this file is INVISIBLE in the UI. A tool that should
//  be off but is on costs money on every single request, and no screen says so.
//  So the assertions here are deliberately narrow and named after the bug they
//  prevent, not after the function they call.
// ══════════════════════════════════════════════════════════════════════════

describe('the pack table itself holds up', () => {
  it('every tool on every server is claimed by some pack or listed as deliberately off', () => {
    // 🚨 The most important test here. An unclaimed tool is one that gets
    //    silently disabled the moment anyone touches a pack on its server,
    //    and nothing in the UI will ever mention it.
    const report = validate(freshState(), packs, disabled)
    expect(report.unassigned).toEqual({})
  })

  it('the deliberately-off list is exactly what we think it is', () => {
    // This is a lock, not a check: it makes someone editing the off-list
    // prove they meant to, rather than quietly widening it.
    expect(disabled).toEqual({
      github: ['list_notifications', 'mark_notification_read'],
    })
  })
})

describe('turning a pack on', () => {
  it('does not drag in the rest of the server', () => {
    // The whole point: "reading code" must not also hand the model the ability
    // to close your issues and merge your PRs, just because they share a server.
    const next = apply(freshState(), 'code', true)
    expect(enabledOn(next, 'github')).toEqual(['get_file', 'list_commits', 'search_code'])
  })

  it('leaves servers the pack never mentions completely alone', () => {
    const next = apply(freshState(), 'code', true)
    expect(next.attached).not.toContain('slack')
    expect(next.attached).not.toContain('postgres')
    expect(enabledOn(next, 'slack')).toEqual(['list_channels', 'send_message', 'upload_file'])
  })

  it('turns on the client-side tools the pack asks for too', () => {
    const next = apply(freshState(), 'code', true)
    expect(next.localTools).toContain('clipboard')
  })

  it('makes the pack report as on — computed, not stored', () => {
    const state = freshState()
    expect(isOn(state, packOf('code'))).toBe(false)
    expect(isOn(apply(state, 'code', true), packOf('code'))).toBe(true)
  })
})

describe('two packs on the same server', () => {
  it('union their tools instead of fighting', () => {
    let state = apply(freshState(), 'code', true)
    state = apply(state, 'issues', true)
    expect(enabledOn(state, 'github')).toEqual([
      'close_issue',
      'comment_issue',
      'create_issue',
      'get_file',
      'list_commits',
      'list_issues',
      'search_code',
    ])
  })

  it('both report as on, even though they share a server', () => {
    let state = apply(freshState(), 'code', true)
    state = apply(state, 'issues', true)
    expect(isOn(state, packOf('code'))).toBe(true)
    expect(isOn(state, packOf('issues'))).toBe(true)
  })

  it('overlap on the same tools without either pack breaking', () => {
    // `filesystem::read_file` belongs to both `code` and `files`.
    let state = apply(freshState(), 'code', true)
    state = apply(state, 'files', true)
    expect(enabledOn(state, 'filesystem')).toEqual([
      'list_directory',
      'move_file',
      'read_file',
      'write_file',
    ])
    expect(isOn(state, packOf('code'))).toBe(true)
    expect(isOn(state, packOf('files'))).toBe(true)
  })
})

describe('turning a pack off', () => {
  it('leaves the other pack on the same server intact', () => {
    let state = apply(freshState(), 'code', true)
    state = apply(state, 'issues', true)
    state = apply(state, 'code', false)

    expect(isOn(state, packOf('issues'))).toBe(true)
    expect(isOn(state, packOf('code'))).toBe(false)
    expect(enabledOn(state, 'github')).toEqual([
      'close_issue',
      'comment_issue',
      'create_issue',
      'list_issues',
    ])
  })

  it('detaches a server that ends up with nothing on', () => {
    // A server attached with zero enabled tools is dead weight — and a
    // `0 enabled` server is also how a client tells "the user turned this off"
    // apart from "this is still hanging around".
    let state = apply(freshState(), 'code', true)
    expect(state.attached).toContain('github')

    state = apply(state, 'code', false)
    expect(state.attached).not.toContain('github')
    expect(state.attached).not.toContain('filesystem')
    expect(enabledOn(state, 'github')).toEqual([])
  })
})

describe('the guard against a stale tool list', () => {
  // 🚨 This is the one that hurt. The client's tool list is a CACHE — whatever
  //    it last got from `tools/list`. If the server adds tools and the client
  //    hasn't synced, a pack naming those tools matches nothing. The union
  //    algorithm then computes an empty desired set, disables every tool on
  //    that server, and detaches it. The user sees a switch that did nothing;
  //    what actually happened is the whole server went dark mid-conversation.
  const stalePack: Pack = {
    id: 'stale',
    title: 'References a tool that does not exist yet',
    mcpTools: { github: ['get_file', 'brand_new_tool'] },
  }

  it('refuses to move at all when a referenced tool is missing', () => {
    const before = freshState()
    const result = resolve(before, [stalePack], 'stale', true)

    expect(result.blocked).toEqual([{ server: 'github', missing: ['brand_new_tool'] }])
    // Nothing changed — not one tool, not the attached list.
    expect(result.state).toEqual(before)
  })

  it('reports exactly which names are missing, so the UI can say why', () => {
    expect(unavailable(freshState(), stalePack)).toEqual([
      { server: 'github', missing: ['brand_new_tool'] },
    ])
  })

  it('still allows turning a pack OFF, even if the server dropped a tool for good', () => {
    // The escape hatch. If we blocked the off-direction too, a pack whose tool
    // was permanently removed could never be switched off again.
    const state = apply(freshState(), 'code', true)
    const serverless = { ...state, servers: state.servers.filter((s) => s.name !== 'github') }
    const result = resolve(serverless, packs, 'code', false)
    expect(result.blocked).toBeUndefined()
  })
})

describe('isOn is derived, so hand-edits never desync it', () => {
  it('stays on when an unrelated tool is enabled by hand', () => {
    const state = apply(freshState(), 'code', true)
    const handEdited: AppState = {
      ...state,
      servers: state.servers.map((s) =>
        s.name === 'github'
          ? { ...s, tools: s.tools.map((t) => (t.name === 'list_issues' ? { ...t, enable: true } : t)) }
          : s,
      ),
    }
    expect(isOn(handEdited, packOf('code'))).toBe(true)
  })

  it('goes off the moment one member is missing', () => {
    const state = apply(freshState(), 'code', true)
    const crippled: AppState = {
      ...state,
      servers: state.servers.map((s) =>
        s.name === 'github'
          ? { ...s, tools: s.tools.map((t) => (t.name === 'get_file' ? { ...t, enable: false } : t)) }
          : s,
      ),
    }
    expect(isOn(crippled, packOf('code'))).toBe(false)
  })
})

describe('resolve is a pure function over a whole new state', () => {
  it('never mutates the state it was given', () => {
    const before = freshState()
    const snapshot = structuredClone(before)
    apply(before, 'code', true)
    expect(before).toEqual(snapshot)
  })

  it('returns tools and attachment together, so there is no half-applied state', () => {
    // If a caller persisted these as two separate writes, there would be a
    // window where a tool is on but its server isn't attached — and a request
    // landing in that window misbehaves. One return value, one write.
    const next = apply(freshState(), 'code', true)
    for (const name of next.attached) {
      const server = next.servers.find((s) => s.name === name)!
      expect(server.tools.some((t) => t.enable)).toBe(true)
    }
    for (const server of next.servers) {
      if (!next.attached.includes(server.name)) continue
      // ...and every attached server is one we actually enabled something on.
      expect(server.tools.some((t) => t.enable)).toBe(true)
    }
  })
})

describe('validate surfaces the two ways a table goes wrong', () => {
  it('names a tool nobody claimed', () => {
    const state = freshState()
    state.servers.find((s) => s.name === 'slack')!.tools.push({ name: 'a_new_tool', enable: true })
    const report = validate(state, packs, disabled)
    expect(report.unassigned).toEqual({ slack: ['a_new_tool'] })
  })

  it('names a server a pack refers to that no longer exists', () => {
    // The rename case. The pack can never be turned on again, and `isOn` just
    // reports "off" forever with no explanation — so this has to reach the UI.
    const state = freshState()
    state.servers = state.servers.map((s) => (s.name === 'slack' ? { ...s, name: 'slack-v2' } : s))
    const report = validate(state, packs, disabled)
    expect(report.missingServers).toEqual({
      slack: ['list_channels', 'send_message', 'upload_file'],
    })
  })
})

describe('the example file matches the servers it claims to', () => {
  it('references no tool the servers do not have', () => {
    // Keeps examples/packs.example.json honest — the docs and the tests read
    // the same file, so a typo shows up here rather than in someone's client.
    const report = validate(freshState(), packs, disabled)
    expect(report.unavailable).toEqual({})
    expect(report.missingServers).toEqual({})
  })

  it('has a pack for every server it demonstrates', () => {
    const named = new Set(packs.flatMap((p) => Object.keys(p.mcpTools ?? {})))
    expect([...named].sort()).toEqual(Object.keys(ALL_SERVER_TOOLS).sort())
  })
})
