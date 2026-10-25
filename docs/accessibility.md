# Accessibility

The target is WCAG 2.1 AA for everything an operator uses: the plant screens,
faceplates, dialogs and the shell.

## What is checked, and where

| Check | How | Covers |
|---|---|---|
| Theme contrast | `packages/hmi-theme` contract test, on every `npm test` | Every theme defines every token, and text, lines and alarm colours meet their contrast ratios. |
| Structure, names, roles | `apps/demo-electrical/src/screens/a11y.test.tsx` runs axe-core in happy-dom on the overview, substation, wind farm, alarms and comms screens and on three faceplates | Missing names, invalid roles and missing required attributes such as a meter without a value. |
| Contrast on the page, label in name | axe-core in the browser (below) | Rules that need real layout, which happy-dom lacks. |

## Running the browser audit

With the dev server running and signed in, paste this in the browser console.
It visits every screen and lists what axe finds:

```js
await new Promise((ok) => { const s = document.createElement("script"); s.src = "/@fs/" + "<repo>/node_modules/axe-core/axe.min.js"; s.onload = ok; document.head.appendChild(s); });
const out = {};
for (const p of ["overview", "substation", "substation/vds.sub.mv.a.f1.cb", "substation/vds.sub.tr2", "windfarm", "windfarm/vds.wf.f3.t14", "alarms", "events", "trends", "comms", "symbols", "interlocks", "perf"]) {
  location.hash = p;
  await new Promise((r) => setTimeout(r, 2500));
  const r = await axe.run(document);
  out[p] = r.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}`);
}
out;
```

Replace `<repo>` with the absolute path of the repository.

**Last run (2026-10-25, 1920 × 1080, dark grey, signed in on the local
hub): no violations on any of the 13 views.**

## What the audit fixed

- **Label in name** (WCAG 2.5.3): the alarm summary, account chip and turbine
  tiles took their names from an `aria-label` that didn't contain the text
  on screen. They now build their names from the visible content plus
  visually hidden words (`kh-sr-only`), so a speech-input user can say what
  they see.
- **Symbols**: alarm, interlock and local-control badges are drawn only
  (`aria-hidden`). The symbol's name says the same in words, alarm
  included: "F1 CB, Closed, Interlocked, Local control, Priority 1 alarm, not
  acknowledged".
- **Analog bar** without a value: it was a meter with no `aria-valuenow`,
  which isn't valid. It's now an image named "…, no value".
- **Interlock ladder**: the gates were focusable inside an image and did
  nothing but highlight. They are now drawn only; the condition list beside
  the ladder carries the same items for the keyboard.
- **Contrast**: a highlighted faceplate row and a "Blocks here" chip were
  below 4.5:1 on their tints. They now use an edge bar and an outline instead
  of a tint.
- **Page structure**: each page has a top heading (hidden, from the menu), and
  the scrolling main area can take focus, so the keyboard can scroll pages that
  have no controls.

## Built in

- Every control is reachable and usable by keyboard. Symbols that open
  something are buttons (Enter or Space). Faceplates close with Escape, and their tabs
  move with the arrow keys. Faceplates and the command dialog take focus when
  they open, and the result's Close button takes it when a command finishes.
- Focus is always visible (a 3 px ring in the focus colour).
- Alarm flashing and the command progress spinner run only when the user
  allows motion (`prefers-reduced-motion`).
- Alarm priority is never told by colour alone (shape, colour and number), and
  neither is any other state.
- Regular buttons and menu items are 44 px tall (`--hmi-target-min`). The
  compact command buttons in faceplate lists are 32 px, above WCAG 2.2's
  24 px minimum (2.5.8).

## Known limits

- The single-line drawing is one SVG scaled to fit. At small widths its text
  gets small; it's designed for a 1920 × 1080 operator display.
- Screen reader testing has been with the browser's accessibility tree and
  axe, not yet with NVDA or VoiceOver on a full shift scenario.
