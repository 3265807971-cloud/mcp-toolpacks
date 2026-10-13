/**
 * A minimal "one card per pack" list.
 *
 * This is a REFERENCE, not a component library — no CSS file, no dependency on
 * any design system, inline styles so you can see every decision in one place.
 * Copy the structure, throw away the styling, keep the two bits that matter:
 *
 *   1. The card shows the pack's *resolved* state, recomputed from `AppState`
 *      on every render. It never caches "is this pack on" locally.
 *   2. A pack that names a server which doesn't exist says so, loudly. That
 *      pack can never be switched on, and silence would look like a bug in
 *      your switch.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { findServer, isOn, unavailable } from '../../src/index.js'
import type { AppState, Pack } from '../../src/index.js'

export interface PackCardListProps {
  packs: Pack[]
  state: AppState
  /**
   * Flipping a switch. This is where the sync-and-retry dance belongs:
   *
   *   1. If `enable` is true and `unavailable(state, pack)` is non-empty,
   *      re-fetch the tool list from the server first.
   *   2. If it's still non-empty, STOP. Tell the user which names are missing
   *      and that nothing was changed. Do not call `resolve()`.
   *   3. Otherwise call `resolve()` and persist the whole returned state in
   *      one write.
   */
  onToggle: (pack: Pack, enable: boolean) => void
  /** Optional icon per pack. Return `null` to skip. */
  icon?: (pack: Pack) => ReactNode
  /** Optional friendlier labels for server names. */
  serverLabel?: (name: string) => string
}

export function PackCardList({
  packs,
  state,
  onToggle,
  icon,
  serverLabel = (n) => n,
}: PackCardListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {packs.map((pack) => (
        <PackCard
          key={pack.id}
          pack={pack}
          state={state}
          onToggle={onToggle}
          icon={icon?.(pack)}
          serverLabel={serverLabel}
        />
      ))}
    </div>
  )
}

interface PackCardProps {
  pack: Pack
  state: AppState
  onToggle: (pack: Pack, enable: boolean) => void
  icon?: ReactNode
  serverLabel: (name: string) => string
}

function PackCard({ pack, state, onToggle, icon, serverLabel }: PackCardProps) {
  const [open, setOpen] = useState(false)

  // Recomputed every render — never stored. See the note at the top.
  const on = isOn(state, pack)
  const count = toolCount(pack)
  const missing = Object.keys(pack.mcpTools ?? {}).filter((n) => !findServer(state, n))
  const stale = unavailable(state, pack)

  return (
    <section style={card}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon ? <div style={{ flexShrink: 0 }}>{icon}</div> : null}

        <button
          onClick={() => setOpen((v) => !v)}
          style={titleButton}
          aria-expanded={open}
          aria-label={`${pack.title}, ${open ? 'collapse' : 'expand'}`}
        >
          <span style={{ fontWeight: 600 }}>{pack.title}</span>
          {pack.desc ? <span style={desc}>{pack.desc}</span> : null}
          <span style={meta}>
            {count} {count === 1 ? 'tool' : 'tools'} · {on ? 'on' : 'off'}
          </span>
        </button>

        <label style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onToggle(pack, e.target.checked)}
            aria-label={`${pack.title} — ${on ? 'on' : 'off'}`}
          />
        </label>
      </header>

      {/* 🚨 A server this pack names doesn't exist (renamed or deleted).
          The pack can never turn on, and `isOn` just returns false forever —
          so this line is the only thing standing between the user and
          "the switch is broken". It hangs on the card permanently. */}
      {missing.length > 0 ? (
        <p style={warn}>
          ⚠️ Server not found: {missing.map(serverLabel).join(', ')} — renamed, or removed?
        </p>
      ) : null}

      {/* Tools this pack wants that the server doesn't currently expose.
          Usually a stale tool cache. Shown while expanded; the switch handler
          is what actually refuses to move. */}
      {stale.length > 0 ? (
        <p style={warn}>
          ⚠️ Not on the server yet:{' '}
          {stale.map((b) => `${serverLabel(b.server)} → ${b.missing.join(', ')}`).join(' · ')}
        </p>
      ) : null}

      {open ? (
        <div style={details}>
          {pack.localTools && pack.localTools.length > 0 ? (
            <Row label="This client">{pack.localTools.join(', ')}</Row>
          ) : null}

          {Object.entries(pack.mcpTools ?? {}).map(([server, tools]) => (
            <Row key={server} label={serverLabel(server)}>
              {tools.join(', ')}
            </Row>
          ))}

          {pack.note ? <p style={note}>{pack.note}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p style={row}>
      <span style={{ opacity: 0.6 }}>{label}:</span> {children}
    </p>
  )
}

function toolCount(pack: Pack): number {
  const local = pack.localTools?.length ?? 0
  const mcp = Object.values(pack.mcpTools ?? {}).reduce((n, tools) => n + tools.length, 0)
  return local + mcp
}

const card: CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
  borderRadius: 12,
  padding: '12px 14px',
}

const titleButton: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  textAlign: 'left',
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
}

const desc: CSSProperties = { fontSize: 13, opacity: 0.75 }
const meta: CSSProperties = { fontSize: 12, opacity: 0.55 }
const warn: CSSProperties = { margin: '8px 0 0', fontSize: 12, color: '#c0392b' }
const details: CSSProperties = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  fontSize: 12,
}
const row: CSSProperties = { margin: '2px 0' }
const note: CSSProperties = { margin: '8px 0 0', fontSize: 12, opacity: 0.6 }
