# Khorde Demo HMI — Plan (v1: electrical sector)

Status: draft for review · 2026-10-25

## 1. Goals

1. **Showcase**: a live, good-looking HMI that shows what Khorde SCADA can do: real-time measurements, alarms, commands with interlocks, history and trends, and agent/communication health. The demo covers a **wind farm** and a **power substation**.
2. **Reference implementation**: a clean, documented codebase that integrators copy from or depend on to build their own HMI against the Khorde GraphQL API.
3. **Two layers**:
   - `@khorde/hmi-*`: reusable libraries that every customer HMI shares.
   - `apps/demo-electrical`: the project layer that changes from customer to customer (single-line screens, faceplates, menu tree, plant model).
4. **ISA-101 high-performance HMI** throughout, with the **Khorde design system** ("Khorde Design System Updated" on claude.ai) as the visual base.

Out of scope for v1: configuration or engineering tools, a screen editor, mobile layouts, and sectors other than electrical.

## 2. What we know about the platform

| Topic | Source | Notes |
|---|---|---|
| Auth | `scada-deploy/samples/auth`, hmi-starter `auth.ts` | OIDC Authorization Code + PKCE, public client, Zitadel. Scopes: `openid profile email urn:zitadel:iam:org:project:id:khorde_scada:aud urn:zitadel:iam:org:projects:roles`. Roles are `ScadaOperator`, `ScadaViewer` and `ScadaInterlockBypass`. |
| Queries/mutations | samples/graphql, hmi-starter | `POST` + `Authorization: Bearer`. SaaS: `https://api.khorde.io/`. Local hub: `http://localhost:8085/`. |
| Subscriptions | same | `graphql-ws` (`graphql-transport-ws`). The token goes in `connectionParams: { token }`. |
| Known operations | samples | `registeredMeasurements(agents)`, `agentHeartbeats(agents)`, `agentHeartbeatSubscribe(agents)`, `activeAlm`, `almSubscribe` (fields: name, area, timestamp, state, severity, ack, value). |
| Data model | docs/agent-configuration | Measurements are identified by `equipment::name`. Types are `discrete` or `analogical`. `store: true` keeps history. Free-form `tags`. Alarms are digital, discrete (Set/Reset/Event) or analog (HH/H/L/LL with deadband), each with an `area` and a `severity` (low/medium/high). Commands are `equipment` + `name` (e.g. `pos.open`) with an optional `interlock` key. Interlocks are boolean expression trees over measurements. |
| Quality | rest-agent, confirmed | Values carry a timestamp and a quality string, `good` or `bad`. |
| Starter | `khorde-io/hmi-starter` | React 19, TypeScript, Vite 8, `oidc-client-ts`, `graphql-ws`. We stay on the same stack so the reference reads familiar. |

### What the GraphQL schema gives us (`schema.graphql`)

| Need | API | Consequence for the HMI |
|---|---|---|
| Live values | `measByPaths(paths)`, `measByTag(tag)` subscriptions | Paths are `<equipment>.<name>` with `*` (one segment) and `>` (rest) wildcards. The point store can subscribe to a whole screen with one prefix (`vds.sub.>`) instead of one path per symbol. **Equipment naming must therefore be hierarchical** (see 6.1). |
| Current value on open | `measByPaths` / `measByTag` | A new subscription first sends the cached current value of every matching point, then only changes. No separate snapshot query is needed: a screen fills as soon as its subscription opens. |
| Quality | `Measurement.quality: String` | `good` or `bad`. The client maps it to a typed enum and treats anything else as `bad`. |
| History / trends | `histAnalogical`, `histDiscrete` with `{ timestamp: {from, to}, name }` | `name` is the full `equipment.name` path and takes the same `*` / `>` wildcards (**assumed**: the backend does not support this yet). There is no pagination, so the history service caps the time range per request, splits long ranges into chunks, and downsamples for uPlot. |
| Alarms | `activeAlm(areas)`, `almSubscribe(areas)`, `alm(filter)` history, `almAck(instanceId)` | Areas use the same wildcards. Each alarm has `condition`, `instanceId`, ack state, ack time and who acked it. Three severities (`high / medium / low`) map to priorities P1 to P3. No shelving in the API, so none in v1. |
| Commands | `discreteCommandRequest(agent, equipment, name, bypassInterlock)`, `analogicalCommandRequest(…, value)` | A discrete command carries no value: the command name is the action (`pos.open`, `pos.close`). The mutation returns a request id. There is no select-before-operate in the API (SBO lives in the agent driver), so the two-step select/confirm in the UI is client-side. |
| Command progress | `requestUpdate(requestId)` query | No subscription, so the command service polls it until a final state: `FORWARDED_TO_AGENT → AGENT_RECEIVED → AGENT_SENT → REQUEST_SUCCESS / TIMEOUT / ERROR`. The dialog shows each step. |
| Interlocks | `commandInterlockStates(commands)` (PERMIT / BLOCK), `commandInterlockDetail(…)` (expression `graph` + `nodeStates` per path, including `BAD_QUALITY`) | Faceplates show whether a command is permitted before the operator clicks. A **blocked command shows the interlock tree** with the failing branch highlighted. This is a strong showcase feature. States are queried, not streamed: the HMI re-queries when one of the interlock's input points changes. |
| Interlock bypass | `bypassInterlock: true` + role `ScadaInterlockBypass` | The backend enforces the role. The UI only offers bypass to users who have it in their token, as a separate, deliberate action with its own confirmation, and shows `FORWARDED_TO_AGENT_INTERLOCK_BYPASSED` in the progress steps. |
| Health | `agentHeartbeats` / `agentHeartbeatSubscribe`, `siteHeartbeats` / `siteHeartbeatSubscribe` | Footer shows agent health and, for hybrid deployments, the site-to-cloud link. |
| Discovery | `registeredMeasurements`, `registeredCommands` | In development the app checks that every point and command bound on a screen exists, and warns about typos. |
| Event log | `alm(filter)` only | There is no global command audit query, so the v1 event log is alarm history (Set / Reset / Event and acks). |

## 3. Stack (decided)

- **TypeScript** everywhere, strict mode.
- **React 19** for the UI layer. It is the most widely known framework among the integrators this reference targets, and it matches `hmi-starter`. Live values reach components through `useSyncExternalStore`, one subscription per point, so a value change re-renders only the symbols bound to that point and not the whole screen. That keeps React fast enough for dense screens.
- **Vite** for the dev server and app builds. The in-repo packages are consumed as TypeScript source (each `exports` points at `src/`), so they need no build step; a library build is added only if they are published.
- **devenv (Nix)** provides the toolchain (Node 24, npm, TypeScript), so `devenv shell` or direnv gives everyone the same versions.
- **Plain CSS with custom properties** from `hmi-theme`, plus CSS modules inside components. No CSS-in-JS runtime cost and no Tailwind, so integrators using other frameworks can reuse the theme as-is.
- **Hand-written SVG** for the symbols; no canvas or diagram engine.
- **`oidc-client-ts`** for auth and **`graphql-ws`** plus `fetch` for the API. No Apollo or urql: the point store is our cache, and a heavy GraphQL client would hide the API calls the reference should show. Query and type definitions are generated from the schema with **GraphQL Code Generator** (typed documents only).
- **React Router** for screen navigation, **uPlot** for trends (fast with many points), **Lucide** for icons.
- **Vitest** + Testing Library for tests, **oxlint** for linting (same as `hmi-starter`), **npm workspaces** for the monorepo.

## 4. Repository layout

npm workspaces monorepo (pnpm also works), all TypeScript.

```
demo/
├─ packages/
│  ├─ hmi-core/          @khorde/hmi-core      framework-agnostic, zero UI
│  ├─ hmi-react/         @khorde/hmi-react     React bindings, shell, widgets, symbols
│  └─ hmi-theme/         @khorde/hmi-theme     CSS tokens: Khorde DS + ISA-101 process palette
├─ apps/
│  └─ demo-electrical/   the customer layer (screens, menus, faceplates, plant model)
├─ sim/
│  ├─ site-config/       agent config (measurements, alarms, commands, interlocks) for the demo plant
│  └─ simulator/         Node script driving the rest-agent: physics-lite plant + command webhook
└─ docs/                 "Build your own HMI with the Khorde libs" guide
```

**The libraries stay in this repo for now.** They are npm workspace packages that the app links to directly; nothing is published. They keep their `@khorde/` names and build setup, so publishing them later only takes a release step.

**Why three packages instead of one.** `hmi-core` has no React dependency, so a Vue, Svelte or vanilla integrator can still reuse auth, transport, the point store, the alarm store and the command flow. `hmi-theme` is plain CSS, so it works with any framework. `hmi-react` is our opinionated UI layer.

## 5. Layer 1: shared libraries

### 5.1 `@khorde/hmi-core`

| Module | Responsibility |
|---|---|
| `auth` | Wraps `oidc-client-ts`: login/logout redirect, callback handling, silent renew, `onTokenChanged`. Parses the Zitadel role claim into `ScadaOperator` / `ScadaViewer` / `ScadaInterlockBypass` and exposes `can(permission)` (`view`, `operate`, `bypassInterlock`). The UI uses it only to hide or disable actions; the backend is the authority. Configured from `{ authority, clientId, projectId, redirectUri }`. |
| `transport` | One HTTP client and **one** shared `graphql-ws` client per session: lazy connect, retry with backoff, the token re-read on each reconnect, and connection state (`connecting / online / degraded / offline`) for the footer. |
| `points` | The **point store**. Components ask for `equipment::name`. The store groups what is on screen into as few `measByPaths` subscriptions as possible (prefix wildcards where it can), ref-counted, and re-subscribes when the screen changes. Each subscription first delivers the cached current values, then changes. Values are cached as `{ value, quality, timestamp, stale }`. Because unchanged values are not re-sent, age alone does not mean stale: a point is marked stale when its subscription is down or its agent's heartbeat is offline, and cleared when the subscription re-delivers its values. Updates are batched to `requestAnimationFrame` so a busy plant doesn't re-render per message. |
| `alarms` | Seeds from `activeAlm`, then live via `almSubscribe`. Exposes a normalized alarm list, counts per priority, area and ack state, and `ack(alarm)` / `ackArea(area)`. Acks go through `almAck(instanceId)`. |
| `commands` | The command flow: `select → confirm → request → track`. Checks the operator role, reads the interlock state (`commandInterlockStates`) and, when blocked, the detail tree. Sends the mutation, then polls `requestUpdate` until a final state or a client timeout. Returns a typed result (`success / blocked(interlock) / timeout / error`). |
| `interlocks` | Interlock state per command, refreshed when an input point changes; parses the `graph` + `nodeStates` into a tree the UI can draw. |
| `history` | Trend and event history queries, with downsampling and range helpers. |
| `agents` | Agent and site heartbeat queries and subscriptions, mapped to communication-health status per equipment. |
| `i18n` | Translates every text shown on screen (see 5.4). Framework-agnostic: dictionaries, lookup with fallback, and `Intl` number, date and unit formatting. |
| `config` | Loads and validates the runtime config (see 5.5). |
| `model` | Types for `Point`, `Quality`, `Alarm`, `Command`, `Interlock`, and parse/format helpers for `equipment::name`. |
| `mock` | An in-memory backend with the same interfaces, so the tests and an offline demo run without a hub. |

### 5.2 `@khorde/hmi-theme`

- **Brand tokens** come straight from the Khorde DS (`tokens.json`): Range Green `#002826`, Wide Green `#033D32`, Magnetic Green `#C2FD00`, Light Frequency `#E3FD9E`, Concrete `#80806B`, General Sans, IBM Plex Mono, and the spacing, radius and motion scales.
- **The ISA-101 process palette** is an HMI-specific extension: a greyscale ramp for backgrounds, static equipment, live and dead lines, and values. Saturated color is reserved **only** for alarm priorities and abnormal states, taken from the DS alarm categories: `cat-danger` (P1), `cat-warning` (P2), `cat-info` (P3), `cat-interlock` (interlock/inhibit), `cat-neutral` (diagnostic or shelved).
- **The rule that resolves brand vs ISA-101**: the bright brand colors (Magnetic Green lime, Light Frequency) live in the **application chrome** only: header, navigation, login, focus rings, the selected nav item. They never appear in process graphics, so lime never competes with an alarm. The dark brand greens, Ink and Concrete may be used as low-saturation process grounds and greys (see the themes below).
- **v1 ships three themes, all selectable** (validated in the mockups):

  | Theme id | Process background | Greys | Header |
  |---|---|---|---|
  | `dark-grey` (default) | `#2B2F2F` neutral dark grey | cool greys | Range Green `#002826` |
  | `range-green` | `#062A27`, Range Green slightly lifted | Concrete-tinted (`#80806B` lightened) | `#001512`, darker than the ground |
  | `ink` | `#1B1B17`, Ink lifted out of black | Concrete-tinted | Range Green `#002826` |

  In `range-green`, P3 teal is close in hue to the background, so that theme uses a light blue (`#78B4FF`) for P3. The contract test below checks it (alarm hues at least 30° from a saturated background).
- **Theme selection works in v1**:
  - A theme picker sits in the user menu in the header (and in a small settings panel), listing every registered theme by its dictionary name.
  - Switching is instant: it sets `data-theme` on the root element, with no reload.
  - The choice is stored per user in the browser (keyed by the user's `sub`). The app config sets the default, and can limit which themes are offered.
  - `hmi-core` exposes a small framework-agnostic theme service (`list`, `get`, `set`, `onChange`); `hmi-react` adds `useTheme()` and the picker component.
- **Built for more themes later**, for example high contrast, palettes for color-vision deficiencies (protanopia, deuteranopia, tritanopia), larger text, or a light grey daylight theme:
  - Components only use **semantic tokens** (`--proc-bg`, `--proc-line-live`, `--alarm-p1`, `--text-value`, …), never brand or raw colors, including inside SVG symbols.
  - A theme is one CSS file that sets those tokens under `[data-theme="<id>"]`. Adding a theme means adding a file and registering it (id plus a dictionary key for its name); no component changes.
  - Customers can add their own themes in their layer, the same way.
  - Themes can also scale type, line widths and symbol stroke widths through tokens, not only colors.
  - A token contract test checks that every theme defines every token and meets contrast minimums (text 4.5:1, symbols and lines 3:1, alarm colors distinguishable from the background by lightness).
- **Redundant coding**: every alarm color is paired with a shape and a priority number (for example ◆1, ▲2, ■3), so color is never the only cue. This is also what makes color-vision themes possible.

### 5.3 `@khorde/hmi-react`

**Hooks**: `useAuth`, `usePoint('eq::name')`, `usePoints([...])`, `useAlarms(filter)`, `useCommand(eq, name)`, `useHistory(...)`, `useAgentHealth(...)`, `useNavigation()`.

**Application frame (shell)**
- `AppShell`: header, a main view area and footer. The lib does not fix a resolution: layout regions and the screen canvas size are props, so each customer chooses their target displays (single screen, multi-monitor, video wall) in their own layer. The demo targets one 1920×1080 screen.
- `Header`: logo and site name, the **alarm summary** (counts per priority, unacked flashing only for new alarms), a **most-recent-alarm banner**, the main navigation, the user and role, and a UTC/local clock.
- `NavTree` / `Breadcrumb`: ISA-101 levels L1 to L4 plus back/forward history. Customers configure the menu tree as data.
- `Footer`: GraphQL connection state, agent health summary, data latency, and the logged-in user and role.
- `Login` / `SessionExpired` / `AccessDenied` screens.

**Generic widgets (ISA-101 style)**
- `AnalogValue`: number, unit and quality decoration (bad, stale), with an optional alarm indicator next to it.
- `AnalogBar`: a moving-pointer bar with normal band and HH/H/L/LL limit marks (the HP "analog indicator"), so operators read *where* a value is, not just its number.
- `Sparkline` and `TrendChart` (live plus history).
- `AlarmIndicator` (shape, priority and ack state), `AlarmList` (sort, filter by area and priority, ack), `EventList`.
- `Faceplate`: a modal or side-panel frame with tabs (Overview, Control, Alarms, Trend, Info).
- `CommandDialog`: two-step select/confirm, then the request's progress steps and final result. Disabled with a reason for viewers.
- `InterlockTree`: draws an interlock expression with each node's live state (permit, block, bad quality), so the operator sees exactly which condition blocks a command.
- `QualityBadge`, `CommStatus`, `StatusDot` (from the DS).

**Electrical symbol library (SVG, ISA-101 / IEC-inspired, monochrome by default)**
- `Breaker`: *closed = filled, open = outline*, plus intermediate/fault (hatched), bad quality (dashed and `?`), local/remote, tripped, interlocked. Clickable to open the faceplate.
- `Disconnector`, `EarthingSwitch`, `Busbar`, `Line` (energized = solid dark, de-energized = thin light grey; no per-voltage rainbow), `Transformer2W/3W` with tap position, `Load`, `Generator`, `Capacitor`, `CT/VT`, `Meter`.
- **Wind**: `WindTurbine` (state: producing / available / stopped / fault / curtailed / comms lost, shown by shape and fill, not color), `TurbineTile` for the fleet overview, a `WindRose` / wind speed indicator.
- Each symbol is **pure** (props in, SVG out), with a thin `Bound*` wrapper that reads points. That keeps them easy to test and lets customers bind symbols their own way.

### 5.4 Texts and translation

The backend sends no display text, only identifiers and values: alarm `name`, condition `id`, `state` (`Set` / `Reset` / `Event`), severity, measurement values. **Every text on screen comes from a dictionary in the frontend.**

- **Two dictionary levels**:
  - The **lib dictionary** (`@khorde/hmi-react`) holds the generic UI strings: buttons, dialogs, the shell, quality labels, command results, alarm states and severities.
  - The **project dictionary** (`apps/demo-electrical`) holds the plant texts: equipment names, alarm descriptions per alarm `name` and condition `id`, and state labels per measurement (for example `sub.*.cb::pos`: `0` → "Open", `1` → "Closed", `2` → "Intermediate", `3` → "Fault").
  - The project dictionary can override any lib string.
- **State labels are mapped by pattern**, so one entry covers every breaker (`*.cb::pos`) and a specific point can still override it.
- **Keys are typed**: dictionaries are TypeScript objects, so a missing key in a new language is a compile error. At runtime a missing key falls back to English, then to the raw identifier, and is logged in development.
- **Formatting** of numbers, dates, times and units goes through `Intl` with the active locale.
- **v1 ships English only.** Adding a language means adding one file per level and registering it. The language is chosen per user, with a default from the app config.
- No i18n library: a small typed module in `hmi-core` is enough and keeps the reference easy to read.

### 5.5 Runtime configuration

The same build can target any backend, so the URLs are not compiled in. At startup the app loads `config.json` from its own origin and validates it:

```json
{
  "siteName": "Ventos da Serra",
  "auth": { "authority": "http://auth.localhost:9310", "clientId": "…", "projectId": "khorde_scada" },
  "api": { "http": "http://localhost:8085/", "ws": "ws://localhost:8085/" },
  "defaults": { "theme": "dark-grey", "locale": "en" },
  "themes": ["dark-grey", "range-green", "ink"]
}
```

- **v1 uses the local hub** (values above). Pointing at the SaaS (`https://auth.khorde.io`, `https://api.khorde.io/`, `wss://api.khorde.io/ws`) only takes a different `config.json`.
- The repo ships `config.local.json` and `config.saas.example.json`. A Vite env variable picks which one the dev server serves.

## 6. Layer 2: demo project (`apps/demo-electrical`)

### 6.1 Demo plant (fictional)

**"Ventos da Serra" (VDS) wind complex, 108 MW.** 24 turbines × 4.5 MW on 4 collector feeders of 6 turbines, and a 34.5/138 kV step-up substation with 2 main transformers and a split 34.5 kV bus with a bus coupler. About 490 measurements, 200 alarms and 100 commands.

```
                 Grid ── 138 kV line L1
                            │  CB · line DS · line ES
   ════════════════════ 138 kV bus ════════════════════
            │ CB · DS                       │ CB · DS
          TR1 60 MVA, OLTC               TR2 60 MVA, OLTC
            │ incomer CB · DS               │ incomer CB · DS
   ═══ 34.5 kV bus A ═══ ─[ bus coupler BC ]─ ═══ 34.5 kV bus B ═══
     │F1     │F2     │AUX                    │F3      │F4
   6 WTG   6 WTG   aux TR 34.5/0.38 kV     6 WTG    6 WTG
```

- **Normal operation**: bus coupler open, each transformer exports its own bus (54 MW each).
- **Showcase scenario**: TR1 trips. Bus A is dead, F1 and F2 stop. The operator curtails bus A turbines (one 60 MVA transformer can't take 108 MW), closes the coupler and restores F1 and F2 through TR2. That uses breaker commands, interlocks, analog setpoints, alarms and trends in one story.
- **Per feeder bay**: breaker (position, trip, SF6 low, local/remote), bus disconnector, earthing switch, P / Q / I / V, overcurrent trip.
- **Per transformer**: oil and winding temperature (analog limit alarms), tap position with raise/lower commands, Buchholz and pressure-relief trips, P / Q.
- **Per turbine**: state (producing / available / stopped / fault / curtailed), P, Q, wind speed and direction, rotor rpm, pitch, yaw, generator and gearbox temperatures, availability, curtailment setpoint. Commands: start, stop, reset, `curtail.setpoint` (analogical).

**Interlocks** (configured in Khorde, shown to the operator by `InterlockTree`):
- A disconnector may only operate while its breaker is open.
- An earthing switch may only close while its disconnector is open and the circuit is dead (V below threshold).
- A breaker may not close while its earthing switch is closed.
- The bus coupler may only close while its disconnectors are closed and at least one transformer incomer is open (no transformer paralleling).
- A transformer's 34.5 kV incomer may only close while its 138 kV breaker is closed.

**Naming** is hierarchical, `<site>.<area>.<bay>.<device>`, because subscriptions and alarm areas filter by dotted prefix:
- `vds.sub.hv.l1.cb`, `vds.sub.hv.tr1.cb`, `vds.sub.tr1` (the transformer itself), `vds.sub.mv.a.tr1.cb` (incomer), `vds.sub.mv.a.f1.cb`, `vds.sub.mv.a.f1.es`, `vds.sub.mv.bc.cb`
- `vds.wf.f1.t01` … `vds.wf.f4.t06`
- Example subscriptions: whole substation `vds.sub.>`, bus A `vds.sub.mv.a.>`, one feeder's turbines `vds.wf.f1.>`, every turbine's power `vds.wf.*.*.p_kw`.
- Alarm areas follow the same tree (`vds.sub.tr1`, `vds.wf.f1`).

**The turbine count is configurable.** One plant description file (`plant/plant.yaml`) holds the topology and `turbinesPerFeeder` (default 6). A small generator turns it into:
- the agent config (measurements, alarms, commands, interlocks),
- the simulator's model,
- the demo's equipment list, its wind farm layout and the English equipment names in the dictionary.

The wind farm screen lays out turbine tiles from that list, so changing the count needs no screen changes. The 4 feeders are fixed, because the substation single-line is drawn by hand. A large profile (for example 15 per feeder, 60 turbines, about 1,100 measurements) can be used for performance demos.

### 6.2 Screen hierarchy (ISA-101 levels)

| Level | Screen | Content |
|---|---|---|
| L1 | **Site overview** | Total MW vs available vs curtailment, grid connection status, wind conditions, alarm summary by area, a 24 h production trend. No control. |
| L2 | **Substation single-line** | The full 138/34.5 kV SLD on one screen: line bay, both transformers, buses A and B, bus coupler, 4 feeders and aux. Breakers, disconnectors, earthing switches, P/Q/V/I per bay, energized and dead sections. |
| L2 | **Wind farm layout** | Feeders F1 to F4 with turbine tiles (state, kW, wind), generated from the plant description. |
| L3 | **Bay detail** | One bay (feeder, incomer, coupler or line): equipment states, protection signals, measurements with analog bars, interlock status. |
| L3 | **Turbine detail** | Power curve (actual vs theoretical), rotor, nacelle, pitch and yaw, temperatures with limit bars, availability. |
| L4 | **Alarm list**, **Event log**, **Trends**, **Communications** (agent health) | Diagnostic and analysis screens. |
| Modal | **Faceplates** | Breaker, disconnector, transformer, turbine, analog point. |

### 6.3 What lives in the customer layer

- `plant/`: `plant.yaml` and the files generated from it (equipment list, wind farm layout). Bindings stay in one place.
- `screens/`: TSX screens composed from lib symbols (`<BoundBreaker eq="vds.sub.mv.a.f1.cb" />`).
- `faceplates/`: project-specific faceplates built on the lib `Faceplate` frame.
- `navigation.ts`: the menu tree (L1 to L4).
- `i18n/en.ts`: the project dictionary (equipment names, alarm texts, state labels).
- `public/config.json`: OIDC client id, API URLs, default theme and locale, and site name.

TSX composition is the v1 choice because it is the clearest reference for developers. A declarative JSON or SVG screen format can come later on top of the same bound symbols.

## 7. Simulation (makes the demo alive)

- `sim/site-config`: the agent config YAML (measurements, alarms, commands, interlocks), **generated from `plant.yaml`** and validated against `schemas.khorde.io/v1/agent-config.json`.
- `sim/simulator`: a Node service that
  - generates wind (a slow random walk with gusts), turbine power from a power curve, and feeder and transformer power flows, and pushes them to the **rest-agent** `/batch` about every 1 s;
  - receives commands through the rest-agent **webhook** and applies them with a simple topology model: opening a breaker de-energizes downstream, so power goes to 0, which triggers alarms. Closing the bus coupler moves bus A onto TR2, and an overloaded transformer heats up;
  - supports scripted scenarios: **TR1 trip and recovery through the bus coupler**, transformer oil temperature excursion (HH alarm), feeder overcurrent trip, turbine fault, comms loss (bad quality).
- A `docker-compose` that adds the rest-agent and the simulator to the local hub from `scada-deploy/samples/site`.

## 8. Phases

| # | Phase | Output |
|---|---|---|
| 0 | **Inputs** | Answers to the schema questions, OIDC app registered on the local hub (client id, redirect URLs). |
| 1 | **Mock screens** | Static mockups with the Khorde DS: shell (header, footer, nav), L1 overview, L2 substation SLD, L2 wind farm, a breaker faceplate with command dialog, alarm list, plus a symbol sheet showing every state. We iterate on these until the visual language is approved. |
| 2 | **Scaffold** | Monorepo, TS config, lint, Vitest, and the theme package with tokens. |
| 3 | **Core lib** | auth, transport, the point store, alarms, commands, history, agents, and the mock backend, with unit tests. |
| 4 | **React lib** | Shell, widgets and the electrical and wind symbols, with tests covering every symbol state. |
| 5 | **Simulator and site config** | The demo plant running against a local hub. |
| 6 | **Demo screens** | L1 to L4 screens and faceplates wired to live data. |
| 7 | **Docs and polish** | A "build your own HMI" guide, an ISA-101 rationale page, and accessibility and performance checks (target: 1,000+ points per screen at 1 Hz with no jank). |

## 9. Open questions

None at the moment.

### Backend dependencies

- **History filter by path with wildcards**: the plan assumes `MeasFilter.name` takes a full `equipment.name` path with `*` / `>`. Until the backend supports it, the mock backend implements it so trends can be built and tested.
- **History pagination**: none today. The client caps and chunks ranges; if pagination is added later, only the history service changes.

### Decided

- **Stack**: React 19, TypeScript, Vite (section 3).
- **Design system**: "Khorde Design System Updated".
- **Target display**: chosen by each customer in their layer; the demo targets one 1920×1080 screen.
- **Themes**: v1 ships `dark-grey` (default), `range-green` and `ink`, with a working per-user theme picker. Themes are token-based, so accessibility themes can be added later (5.2).
- **Language**: all display text from frontend dictionaries, English only in v1, any language can be added later (5.4).
- **Backend**: configurable at runtime, local hub in v1 (5.5).
- **Distribution**: libraries stay in this repo as workspace packages (4).
- **API behaviour**: subscriptions send cached current values first; quality is `good` / `bad`; bypass needs `ScadaInterlockBypass` (2).
- **Plant**: option C, 24 turbines (configurable per feeder), 4 feeders, 2 transformers, bus coupler (6.1).
- **No gallery app.**
