# mcp-toolpacks

**Group MCP tools by purpose, not by server. One switch per group.**

[中文](README.md) · [Data format](SPEC.en.md) · [Why it's shaped this way](#seven-things-that-are-not-obvious)

---

## The problem

MCP servers are packaged by **who provides them**, not by **what you're doing
right now**.

A single server routinely bundles four or five unrelated things:

```
github server
├── code     get_file · search_code · list_commits
├── issues   list_issues · create_issue · close_issue · comment_issue
├── PRs      create_pull_request · review_pull_request · merge_pull_request
└── notifs   list_notifications · mark_notification_read
```

You want to ask one question about some code. Your client gives you exactly one
switch: all of it, or none of it.

So you turn on all four. The model can now merge your pull requests. It just
happens not to.

This isn't a flaw in any particular server. It's a flaw in the granularity.
**Grouping should follow intent.**

## The cost

Tool definitions — name, description, JSON schema — are **re-sent verbatim on
every single request**. They aren't fetched on use; they sit in the context.

Rough arithmetic:

| | |
|---|---|
| One tool definition | ~150–300 tokens |
| A 46-tool server | ~7,000–14,000 tokens |
| 200 turns a day | millions of tokens **per day** |

And none of it depends on **whether you use those tools**. Only on how many are
switched on.

Count your own servers: **tools × 200 ≈ tokens burned every turn.**

## The fix

A **pack**: a purpose-named group of tool references, with one switch.

```json
{
  "id": "issues",
  "title": "Working issues",
  "desc": "Read, file, close and comment on issues",
  "mcpTools": {
    "github": ["list_issues", "create_issue", "close_issue", "comment_issue"]
  }
}
```

The key detail: `mcpTools` is keyed by **server name**, and its values are the
**tool names from that server** that this pack wants.

That's the whole trick — **you reference tools by name, not by server**, because
the server grouping was wrong to begin with.

So "issues but not pull requests" becomes expressible. And several packs can sit
on the same `github` server without fighting.

Full format in [SPEC.en.md](SPEC.en.md); a runnable example in
[`examples/packs.example.json`](examples/packs.example.json).

---

## The seven things that are not obvious

The above is background. **This section is the reason this repo exists.**

Every item below cost us a real bug to learn. They're written down so you don't
have to pay for them again.

### 1. Turning a pack on is not "enable its members"

The natural implementation is:

> on = enable the members; off = disable the members.

**That is wrong**, and wrong in a way you won't notice for weeks.

Here's why: servers ship with nearly every tool already `enable: true`. The real
switch is whether the server is *attached at all*. So "enable the members"
re-enables what was already enabled and changes nothing — turn on your *email*
pack and you also get the toy someone bundled onto the same server, because
both were already enabled.

The correct rule reasons about the **outcome**, not the delta:

```
1. Work out which packs are open AFTER this change
2. Look only at the servers THIS pack names — leave every other server alone
3. For each of those servers:
     should-be-on = the UNION of the members of every open pack touching it
     anything outside that union: turn OFF
4. A server left with zero enabled tools: detach it
```

Step 2 is not optional. Without it, turning on the email pack quietly disables
somebody else's server — and that isn't what the user pressed.

Step 3 has a consequence you **must** know about: because it *overwrites* by
union, a tool on a touched server that **no pack claims gets forced off**. If a
user hand-enabled something in a separate settings screen, touching any pack on
that server wipes it.

That's intentional — off is the default. But it's the reason for insight 5.

### 2. Silent failure is the enemy here

When this thing breaks, **the UI doesn't show it.**

- Should be on but is off → the user thinks "this feature is broken".
- Should be off but is on → **you pay for it every single turn, forever, and no
  screen ever says so**.

The second is worse. So everywhere this library can't be sure, it chooses
**not to guess**:

- References don't resolve → change nothing (see 3)
- Server is gone → draw it on the card
- A tool no pack claims → a test exists to catch exactly that

### 3. If the names don't match, don't move a single byte

This one caused a real incident.

The client's tool list is a **cache** — whatever it last got from `tools/list`.
When a server registers new tools and the client hasn't synced yet:

- not one name in the pack matches
- the algorithm in insight 1 matches on names only ⇒ the union is **empty**
- ⇒ every tool on that server gets disabled, and **the server itself is detached**

The user sees a switch that did nothing. What actually happened is that **every
feature on that server stopped working**, mid-conversation.

So refuse at the door:

```ts
if (enable && unavailable(state, pack).length > 0) {
  return { state, blocked: unavailable(state, pack) }  // returned as-is; nothing moved
}
```

**Guard the on-direction only.** Turning a pack *off* must always work — it's the
only escape hatch if a server later drops a tool for good.

The operational half matters just as much:

> user flips the switch → re-fetch the tool list from the server → re-check
> → still missing → **stop, and tell them which names** — not a silent pass, and
> not ploughing ahead anyway

### 4. "Is this pack on" must be computed, not stored

Don't keep a boolean next to the switch.

> pack is on ⟺ every one of its members is on

Storing a boolean is exactly how you get "the toggle says on but it's actually
off" — and you'll usually find out months later, from a bill.

Derive it and that class of bug **cannot exist structurally**.

> ⚠️ There is no "partially on" state. If one member is missing, the pack reads
> as off. Same benefit: nothing extra to store, so nothing to desync.

Note the rule is **per pack**: two packs on one server both report as on. They
don't fight over the tool they share.

### 5. "Deliberately off" needs an explicit list

Following on from insight 1's consequence.

Since unclaimed tools get forced off, **"no pack mentions it" means "silently
disabled"**.

Three months later nobody can tell whether that was a decision or an oversight.

So keep an explicit table:

```ts
const DISABLED = {
  github: ['list_notifications', 'mark_notification_read'],
}
// the reason goes HERE ↑ not in someone's head:
// the client renders notifications itself; these duplicate it and cost ~400 tokens/turn
```

**Adding an entry without writing down why is not allowed.** Unwritten, it's
indistinguishable from broken.

### 6. None of this is visible when it breaks ⇒ write the tests

Repeating it because it's the one item on this list where skipping it *will* bite
you: **these failures are silent**.

So pin the rules down as tests — especially the **union**, since two packs open
at once must not crowd each other out.

The 22 tests in [`test/resolve.test.ts`](test/resolve.test.ts) exist for this.
Each one is **named after the bug it prevents**, not the function it calls.

One of them pins the table itself:

```ts
it('every tool on every server is claimed by some pack or listed as deliberately off', …)
```

If that test fails, tools are being silently disabled.

### 7. Write it back in one go

"Which servers are attached" and "which tools are enabled on them" are **two
pieces of state**. They must be written **together**.

Written separately, there's a window where a tool is on but its server isn't
attached. If a request lands in that window, the user gets something
inexplicable.

So `resolve()` **does not return a delta** — it returns **a whole new
`AppState`**. Persisting it is the caller's single write.

---

## Before you ship this

1. **Give every tool a pack, or put it on the off-list.**
   Miss one and it gets silently disabled the first time a user touches any pack
   on that server.
2. **Give every off-list entry a reason**, in a code comment — not in your head.
3. **Test the union semantics.** At minimum: two packs on, turn one off,
   overlapping tools.
4. **Sync the tool list before flipping a switch, and handle `blocked`.**
   Don't pass over it silently.
5. **Persist the whole new state in one write.** Not two.

## Implementation

```
src/
├── types.ts      the data model — plain interfaces, no framework, no ids to mint
├── resolve.ts    ★ the core: resolve() / isOn() / unavailable()
└── validate.ts   validate() — turns "silent failure" into an assertable report
```

No runtime dependencies. `resolve()` is about eighty lines with a comment on
every branch — porting it to another language is a fifteen-minute job.

```bash
npm install
npm test          # 22 tests, all green
npm run typecheck
```

`test/fixtures.ts` reads its pack table **straight from
`examples/packs.example.json`**, so the docs and the tests can't drift apart.

For what the UI looks like, see
[`examples/react/PackCardList.tsx`](examples/react/PackCardList.tsx) — one file,
no CSS dependency.

## About this repo

This wasn't thought up on a whiteboard. It ran **in a real product for a while**,
and all seven items above came out of that — including the incident in insight 3.

This is the implementation with the business logic stripped out.

— Manman · Xiao Ke

MIT License.
