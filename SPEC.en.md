# Data format

[中文](SPEC.md) · [Back to README](README.en.md)

There are only two kinds of thing in this repo: **what you author** (the pack
table) and **what the client tells you** (the state). Both specs are small.

---

## 1. What you author: the pack table

A pack is **a purpose-named group of tool references**.

```jsonc
{
  "id": "code",                       // required. stable id; also the key you persist "which packs are on" under
  "title": "Reading code",            // required. the big line on the card
  "desc": "Find files, search, read history",   // optional. the small line under it
  "note": "…",                        // optional. footnote, shown only when expanded

  "localTools": ["clipboard"],        // optional. tools your *client* provides

  "mcpTools": {                       // optional. server name → the tool names this pack wants ON
    "github":     ["get_file", "search_code", "list_commits"],
    "filesystem": ["read_file", "list_directory"]
  }
}
```

### Fields

| Field | Required | Notes |
|---|:--:|---|
| `id` | ✅ | Changing it is the same as replacing the pack. Used for icon lookup too |
| `title` | ✅ | |
| `desc` | | One line saying what this pile is for |
| `note` | | Footnote. Good place for "this pack writes things — be careful" |
| `localTools` | | **List only what should be on.** Omit the field entirely if you have no client-side tools |
| `mcpTools` | | Key is the **server name**; value is an array of **tool names** |

### 🚨 Three rules for `mcpTools`

1. **Only list what should be ON**, never what should be off.
   The semantics are **additive**: turning a pack on enables what it names and
   leaves everything else to the union algorithm (below).

2. **One typo in a server name and the pack silently stops working.**
   Packs find servers **by name**. Renames and deletions break them —
   `validate()` reports these as `missingServers`, so please show them to the user.

3. **Prefer not to list every tool a server has.**
   If a pack claims all of a server's tools, what you actually mean is "attach
   that server" — which still works, it just isn't saying anything.

### The "deliberately off" list

Alongside the pack table you need an **explicit off-list**:

```ts
const DISABLED: DisabledTools = {
  github: ['list_notifications', 'mark_notification_read'],
}
```

Shape: `{ serverName: [toolName] }`.

**Why it's not optional:** the union algorithm **overwrites**. On any server a
pack touches, a tool no pack claims gets forced off. So "no pack mentions it"
means "silently disabled". This list turns *off* into something that was
**written down** rather than **inferred**.

> Give every entry a reason, in a code comment. The reason is for your future
> self — in three months nobody can tell a decision from an oversight.

---

## 2. What the client tells you: the state

```ts
interface ToolState   { name: string; enable: boolean }

interface ServerState {
  name: string                 // this is what packs match on
  tools: ToolState[]           // your cache of the last tools/list
}

interface AppState {
  localTools: string[]         // client-side tools currently on
  attached: string[]           // servers currently attached to this assistant (by name)
  servers: ServerState[]       // every server you know about
}
```

### Two things to watch

**`servers[].tools` is a cache, not live.**
It's whatever you last got from `tools/list`. **Staleness here is the root cause
of the incident described in insight 3.** Don't treat it as truth.

**`attached` is keyed by server name.**
If your client keys servers by UUID internally (many do), keep the UUID in your
own model and map name ↔ id in the adapter that produces this `AppState`.

---

## 3. `resolve(state, packs, packId, enable)`

Toggle one pack. **Pure**: does not mutate the state you pass in, returns a
complete new one.

```ts
interface ResolveResult {
  state: AppState
  blocked?: { server: string; missing: string[] }[]   // non-empty = nothing changed
}
```

### Behaviour contract

1. **Guard.** If `enable` is true and `unavailable(state, pack)` is non-empty,
   **return `state` untouched**, with `blocked` listing the missing names.
   *The off-direction is not guarded* — turning a pack off must always work.
2. **Local tools**: union on enable, difference on disable.
3. **Which packs are open**: `packs.filter(p => isOn(state, p))`, then add/remove
   `packId` per `enable`. Note this is computed against the state **before** the change.
4. **Touch only the servers `pack.mcpTools` names.** Every other `ServerState` is
   returned as-is.
5. **For each touched server**: the tools that should be on are the **union** of
   the members of every open pack that also touches this server. Everything else
   gets `enable: false`.
6. **Detach**: a touched server left with zero enabled tools is removed from
   `attached`. A server with enabled tools is added to it.

> Step 5 means *overwrite*: a tool on that server that was enabled by hand and
> claimed by no pack gets turned off. That is by design.

### Idempotence

Calling `resolve(..., true)` twice for the same `packId` leaves the state
unchanged on the second call.

---

## 4. `isOn(state, pack)`

```ts
isOn(state, pack): boolean
```

**A pack is on ⟺ every one of its members is on.**

- every `localTools` member is in `state.localTools`;
- every server named by `mcpTools` **exists**, is in `attached`, and every tool
  it names is `enable`.

Because "server doesn't exist ⇒ off" is part of the rule, a renamed server makes
its pack **permanently un-onable** — and it just looks "off".
⇒ That has to reach the UI via `validate().missingServers`.

**This value is derived. Never store it.**

---

## 5. `validate(state, packs, disabled?)`

```ts
interface ValidationReport {
  unassigned:     Record<string, string[]>   // on a server, claimed by no pack, not deliberately off
  unavailable:    Record<string, string[]>   // named by a pack, not currently on the server
  missingServers: Record<string, string[]>   // named by a pack, server doesn't exist at all
}
```

| Field | Meaning | What to do |
|---|---|---|
| `unassigned` | **the ones that get silently disabled** | assert it's empty in tests. Non-empty = tools failing silently |
| `unavailable` | stale cache, or a renamed tool | have the user sync; `resolve()` will refuse to run because of this |
| `missingServers` | server renamed or removed | show it on the card. Those packs can never be turned on |

`unassigned` is the only one of the three that should **always be empty**.
