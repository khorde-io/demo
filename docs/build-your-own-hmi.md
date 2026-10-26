# Build your own HMI

This repository is two things: the Ventos da Serra demo, and the libraries
it is built from. This guide is for an integrator who wants an HMI for their
own plant on the Khorde GraphQL API. It walks from an empty app to a screen
with live values, commands, interlocks, alarms and trends, using the demo
(`apps/demo-electrical`) as the worked example.

## The two layers

| Layer | Packages | Changes per customer? |
|---|---|---|
| **Libraries** | `@khorde/hmi-core` (auth, transport, live values, alarms, commands, interlocks, energization, history, texts, config), `@khorde/hmi-theme` (design tokens and themes), `@khorde/hmi-react` (hooks, shell, widgets, symbols, faceplate, dialogs) | No. Depend on them. |
| **Project** | Your app: plant description, dictionary, screens, faceplates, menu | Yes. This is what you write. |

`hmi-core` has no React in it, so another UI framework can use it as is.

## 1. Start from config

The same build runs against any backend: the URLs are read at startup from
`config.json` on the app's own origin.

```json
{
  "siteName": "Ventos da Serra",
  "auth": { "authority": "http://auth.localhost:9311", "clientId": "<your app's client id>", "projectId": "khorde_scada" },
  "api": { "http": "http://localhost:8085/", "ws": "ws://localhost:8085/" },
  "defaults": { "theme": "dark-grey", "locale": "en" },
  "themes": ["dark-grey", "range-green", "ink"]
}
```

- Register the HMI as an OIDC app (PKCE, public client) in the identity
  provider, with your app's URL as redirect and post-logout URI.
- Give users the roles they need: `ScadaViewer` to see, `ScadaOperator` to
  command, `ScadaAlarmAck` to acknowledge, `ScadaInterlockBypass` to bypass.
  Roles only decide what the UI offers; the API checks them again.
- The demo ships `public/config.example.json` (local hub) and
  `config.saas.example.json`. Keep the real `config.json` out of git.

## 2. Wire the core

`createHmi` turns a config into running services. It's a convenience: each
service can also be built on its own from the same pieces.

```ts
import { createHmi, loadConfig } from "@khorde/hmi-core";
import { reactMessages } from "@khorde/hmi-react";
import { THEMES } from "@khorde/hmi-theme";

const config = await loadConfig("/config.json", { themeIds: THEMES.map((t) => t.id), locales: ["en"] });
const hmi = createHmi({ config, catalogs: { en: [{ messages: reactMessages }, projectCatalog] } });
await hmi.auth.init(); // completes the login redirect when this load is one
```

After sign-in, `hmi.start()` loads the registry and starts the alarm list and
the heartbeats. See `apps/demo-electrical/src/boot.ts` and `App.tsx`: the demo
renders `<AuthGate>` (sign-in, expired session, no role) and, inside it, waits
for `start()` with React's `use()`.

```tsx
<HmiProvider hmi={hmi}>
  <AuthGate auth={hmi.auth} site={config.siteName}>
    <AppShell title="Overview" header={<Header … />} footer={<Footer agents={…} />}>
      <Overview />
    </AppShell>
  </AuthGate>
</HmiProvider>
```

Sign-in always shows the identity provider's account picker, and sign-out
ends the session there too, so a shared control-room screen can change hands.

## 3. Describe the plant once

Point ids are `equipment::name`, with dotted equipment ids
(`vds.sub.mv.a.f1.cb::pos`), because Khorde subscriptions and alarm areas
filter by dotted prefix (`vds.sub.>`, `vds.wf.*.t01.p_kw`).

The demo keeps one plant description (`sim/src/plant.ts`) and derives
everything else from it: the agent config uploaded to the hub, the
simulator, the equipment list the screens lay out, and the English names.
That keeps screens and hub from drifting apart. Do the same with your own
source of truth, whether that's a plant model, an engineering export or a
spreadsheet.

## 4. Write the dictionary

The API sends identifiers and numbers, never display text. Every word on
screen comes from a catalog, and the project catalog sits on top of the
library ones:

```ts
const projectCatalog: Catalog = {
  equipment: { "vds.sub.mv.a.f1.cb": "F1 CB" },
  states: { "**::pos": { "0": "Open", "1": "Closed", "2": "Intermediate", "3": "Invalid" } },
  points: { "**::p_mw": "Active power" },
  units: { "**::p_mw": "MW" },
  messages: { alarms: { sub_tr2_oil_temp: { high: "TR2 oil temperature high" } } },
};
```

- `states`, `points` and `units` are keyed by **pattern**, so one entry
  covers every breaker and a specific point can still override it.
- Alarm texts are keyed by alarm name and condition id (`_` for a digital
  alarm's single condition). The demo builds all 157 from the alarm
  definitions (`dictionary.ts`).
- A missing key falls back to English, then to the raw id, and is logged in
  development.

## 5. Draw screens from bound symbols

Symbols are pure SVG groups centred on `(x, y)`: props in, drawing out. The
`Bound*` wrappers take point ids and read them live.

```tsx
<svg viewBox="0 0 1800 1080">
  <Busbar points={[[120, 750], [820, 750]]} energized={busALive} label="34.5 kV bus A" />
  <BoundBreaker pos="vds.sub.mv.a.f1.cb::pos" remoteLocal="vds.sub.mv.a.f1.cb::remote_local"
    x={200} y={892} label="F1 CB" alarm={alarm("vds.sub.mv.a.f1.cb")} onActivate={() => open("vds.sub.mv.a.f1.cb")} />
  <SvgValue id="vds.sub.mv.a.f1::p_mw" x={170} y={888} anchor="end" />
</svg>
```

- **Live values**: `usePoint(id)` for one point, `usePointValues(ids)` for a
  set. A screen only receives the points it shows. The store keeps one
  subscription for everything watched and notifies once per animation frame.
- **Energization** comes from what is measured, in the library: describe the
  wiring once with `networkBuilder` (hmi-core), then `useEnergization(net)`
  (hmi-react) gives each conductor's state for the symbols' `energized`,
  `liveIn` and `liveOut`. Measured nodes (buses, line ends, feeder cables)
  above a threshold are live, and that spreads through every switch that
  conducts. A switch in an unknown position makes what lies beyond it
  unknown, not dead. The switch coding and the threshold are options.

  ```ts
  const net = networkBuilder()
    .source("bus.a", "vds.sub.mv.a::v_kv")
    .device("bus.a", "f1.mid", "vds.sub.mv.a.f1.ds") // supply side first
    .device("f1.mid", "f1.out", "vds.sub.mv.a.f1.cb")
    .link("tr1.hv", "tr1.lv", "vds.sub.tr1") // a transformer always conducts
    .build();

  const live = useEnergization(net);
  const [inSide, outSide] = sides(net, "vds.sub.mv.a.f1.cb")!;
  <BoundBreaker pos="vds.sub.mv.a.f1.cb::pos" liveIn={live(inSide)} liveOut={live(outSide)} … />
  ```

  The demo's `sld/topology.ts` is the Ventos da Serra wiring built this way.
- **Alarms on symbols**: `useEquipmentAlarms()` in the demo picks the most
  urgent alarm whose name starts with the equipment id.
- Draw single-lines by hand (TSX) where the drawing matters. Lay out
  repetitive things, such as the turbine tiles, from the plant description,
  so a different count needs no screen change.

## 6. Faceplates, commands and interlocks

`<Faceplate>` is the frame (tabs, Escape, arrow keys); the content is yours.
The demo's `faceplates/EquipmentFaceplate.tsx` builds one for a bay, a
transformer or a turbine.

Commands go through `<CommandDialog command={key} title verb analog? />`:
select (permission and interlock are checked and a selection starts, which
expires after 30 s), confirm (checked again, then sent), then each request
step as the agent reports it. The API has no select-before-operate, so this
step is in the client. Bypass is offered only to users allowed to bypass.

To explain an interlock: `useInterlock(key)` returns the live tree and
`<InterlockPanel view={view} command="Close" />` draws it as a ladder, from
the request to "command allowed". AND is drawn in series and OR as branches,
and the condition that stops the command is marked.

## 7. Alarms and history

- `<AlarmList>` is the live list, with filters by area, priority and text, and
  ack where the user has `ScadaAlarmAck`. The list follows ISA-18.2: an alarm
  stays until it is both cleared and acknowledged, and a returned,
  unacknowledged alarm is shown as such.
- `<AlarmHistoryList from to filter>` is the event log for a time range, read
  only, with CSV export.
- `useTrend(ids, type, windowMs, label)` with `<TrendChart>` fills a trend from
  history and keeps it moving live. Long ranges are chunked and reduced
  without losing peaks.

## 8. Develop without a hub

`createMockBackend` in `@khorde/hmi-core/mock` implements the same backend
interface in memory: points, commands with interlocks, alarms, heartbeats and
history. `npm run dev:mock` runs the demo plant's simulator in the browser
behind it, alarm definitions included, so every screen can be built and
demonstrated without a hub. The screens can't tell the two backends apart.

## 9. Look, feel and checks

- **Themes** are token sets (`@khorde/hmi-theme`). Add one by defining every
  token, and the contract test checks contrast for you.
- Follow the visual rules in [ISA-101 rationale](isa-101.md): grey process
  graphics, colour reserved for alarms and interlocks, state shown by shape.
- [Accessibility](accessibility.md) and [performance](performance.md) say
  what is checked and how to run the checks on your own screens.

## Checklist for a new project

1. OIDC app and roles in the identity provider, then a `config.json`.
2. A plant description that produces your point ids, and the project catalog.
3. `boot.ts` with `createHmi`, then `App.tsx` with the gate, shell and menu.
4. Screens from bound symbols, and faceplates from `Faceplate`.
5. The mock backend for development and tests, against your own plant.
6. `npm run check`, then the accessibility audit and the performance bench in
   the browser.
