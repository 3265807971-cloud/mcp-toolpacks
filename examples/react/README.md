# React example

`PackCardList.tsx` is the whole UI, in one file.

It is a **reference, not a package.** There's no `react` dependency in this
repo's `package.json` — only `@types/react`, so that `npm run typecheck` still
covers it. Drop the file into your own project (wherever React already lives)
and it will compile.

Two things in it are worth copying even if you throw the rest away:

1. **The switch state is derived, never stored.** `isOn(state, pack)` is called
   on every render. If you cache it in component state you have recreated the
   exact bug `resolve.ts` spends forty lines explaining.
2. **A pack naming a missing server says so on the card.** Such a pack can never
   be turned on — `isOn` just reports `false` forever — so without that line the
   user sees a dead switch and reports a bug you can't reproduce.

The `onToggle` prop is where the sync-and-retry flow goes. See the doc comment
on it, and step 3 of *Before you ship this* in the main README.
