# Architecture

How the HMI is put together, why, and how it maps onto the Khorde API. For
building a screen, see [Build your own HMI](build-your-own-hmi.md). For the
visual rules, see [ISA-101 rationale](isa-101.md).

## Two layers, three libraries

| Package | Depends on | What |
|---|---|---|
| `@khorde/hmi-core` | `oidc-client-ts`, `graphql-ws` | Everything that isn't UI: auth, transport, live values, alarms, commands, interlocks, energization, history, texts, config, the mock backend. No React. |
| `@khorde/hmi-theme` | nothing | Design tokens and the themes, as plain CSS custom properties. |
| `@khorde/hmi-react` | core, theme, React 19 | Hooks, the application shell, widgets, symbols, faceplate, dialogs. |
| `apps/demo-electrical` | all three | The project layer: plant wiring, dictionary, screens, faceplates, menu. |
| `sim` (`@khorde/demo-plant`) | `yaml` | The plant description, the generated agent config, and the simulator. |

- **Why core has no React:** an integrator using Vue, Svelte or plain
  TypeScript can still reuse auth, transport, the point store, alarms and
  commands, and only rewrite the UI.
- **Why the theme is plain CSS:** it works with any framework, costs nothing
  at runtime, and a customer adds a theme by adding a file.
- **Nothing is published.** The packages are npm workspaces consumed as
  TypeScript source (`exports` points at `src/`), so there is no build step
  between them. They keep `@khorde/` names, so publishing them is only a
  release step.

## Stack choices

| Choice | Why |
|---|---|
| React 19, TypeScript (strict), Vite | The framework most integrators know, and the same as `khorde-io/hmi-starter`, so the reference reads familiar. |
| `oidc-client-ts` and `graphql-ws` with `fetch`, no Apollo or urql | The point store is the cache. A heavy GraphQL client would hide the API calls this reference is meant to show. |
| All GraphQL operations in one file (`hmi-core/src/graphql/documents.ts`), typed by hand | A test validates every document against `schema.graphql`, so a schema change fails the build, not a screen. For about 20 operations, code generation cost more than it saved. |
| Hand-written SVG symbols and trend chart | No canvas or diagram engine to learn, symbols are props in and SVG out, and everything stays themeable through tokens. |
| Hash routes, no router library | Seven screens and a faceplate per route don't need one. |
| Small typed i18n module, no library | Missing keys fail to compile, and the reference stays easy to read. |
| Vitest, Testing Library, happy-dom, oxlint, axe-core | Fast checks that run in `npm run check`, accessibility included. |
| devenv | Everyone gets the same Node and npm. Plain Node 24 also works. |

## hmi-core modules

| Module | Responsibility |
|---|---|
| `backend` | The `ScadaBackend` interface: every operation the HMI needs, in HMI types. `graphql/` implements it against the API and `mock/` in memory. Every store talks only to this interface. |
| `graphql/transport` | Queries and mutations over HTTP, subscriptions over one shared `graphql-ws` socket. The token is read on every request and every reconnect. |
| `auth` | OIDC code flow with PKCE, silent renew, the account picker on sign-in, and sign-out at the identity provider. Reads the role claim into `can(permission)`. It only decides what the UI offers; the API checks roles again. |
| `points` | The point store: one `measByPaths` subscription for everything watched, re-opened when the set changes, with listeners notified once per animation frame. A point is stale when its subscription is down or its agent is offline, not because of its age, since unchanged values aren't re-sent. |
| `paths` | Matching point ids against `*` / `>` patterns, and reducing a set of patterns. |
| `alarms` | The active list: seeded from `activeAlm`, then kept current from `almSubscribe`, applying the active-alarm rule (ISA-18.2 by default). Counts per priority, ack and ack-many, and the history query for the event log. |
| `commands` | Select, confirm, request, track. Select checks permission and interlock and expires; execute re-checks, sends, and polls `requestUpdate` to a final state. |
| `interlocks` | Parses `commandInterlockDetail` into a tree for the ladder, and watches the state of each command, re-querying when an input changes. |
| `topology` | Energization from what is measured: a wiring description and a pure `energize` function. |
| `history` | Trend history, split into chunks, merged and reduced without losing peaks. |
| `agents` | Agent and site heartbeats, and the registry. |
| `i18n` | Layered catalogs (library, then project), patterns for state labels, names and units, `Intl` formatting. |
| `config`, `theme`, `hmi` | The runtime config, the active theme, and `createHmi`, which wires it all together. |
| `store` | A minimal observable (`get` + `subscribe`) that every service uses, and that maps directly onto `useSyncExternalStore`. |

## How the HMI uses the API

| Need | API | Consequence |
|---|---|---|
| Live values | `measByPaths(paths)` subscription | Paths take `*` (one segment) and `>` (the rest), so equipment ids are hierarchical (`vds.sub.mv.a.f1.cb`). A new subscription sends the cached value of every match first, so there's no snapshot query. |
| Quality | `Measurement.quality`, `good` or `bad` | Anything else is treated as `bad`. |
| Alarms | `activeAlm`, `almSubscribe`, `alm(filter)`, `almAck(instanceId)` | The subscription streams changes, not the list, so the client applies the active-alarm rule. The store subscribes before the initial query and buffers, so nothing raised in between is lost. `alm` feeds the event log only. |
| Commands | `discreteCommandRequest`, `analogicalCommandRequest` | A discrete command carries no value: the name is the action (`pos.open`). There's no select-before-operate in the API, so select/confirm is in the client. |
| Command progress | `requestUpdate(requestId)` | No subscription, so it is polled. The dialog shows each step. |
| Interlocks | `commandInterlockStates`, `commandInterlockDetail` | Queried, not streamed: the HMI re-queries when an input point changes. Buttons show the state; the ladder shows the tree with the condition that blocks. |
| Bypass | `bypassInterlock: true` | Needs `ScadaInterlockBypass`, which the API enforces. The UI offers it only to users who have it. |
| Health | `agentHeartbeats`, `agentHeartbeatSubscribe` | The footer and the comms screen; an offline agent makes its points stale. |
| Roles | `ScadaViewer`, `ScadaOperator`, `ScadaAlarmAck`, `ScadaInterlockBypass` | The token must carry the project and role scopes, or the API rejects it. |

## Backend limits the client works around

Each workaround sits behind the backend interface, so only the query
building changes when the API does.

- **History filter:** `MeasFilter.name` is a regex on the point name only, so
  it can't select by equipment or take `*` / `>`. The client sends an
  anchored name regex (`^p_mw$`) and filters equipment itself. The value is
  put into the SQL unescaped (reported).
- **No history pagination or downsampling:** the client caps and chunks
  ranges and reduces the result.
- **Interlock node paths:** `$` is the root, a child of `and` / `or` adds
  `.<op>.<index>` (`$.and.3.or.0`), and a reference adds `.ref:<key>`. The
  child of a `not` is assumed to add `.not`, since the hub has no `not` yet.
  Fixture: `packages/hmi-core/test-data/interlock-detail.bus-coupler.json`.
- **No shelving or suppression:** not in the API, so not in the HMI.
- **Wished for:** an alarm subscription that sends the active list first and
  then changes, which would replace `activeAlm` + `almSubscribe` and the
  client-side rule.

## The demo plant

One plant description (`sim/src/plant.ts`) is the source of truth. The agent
config uploaded to the hub, the simulator, the equipment list the screens lay
out and the English names are all derived from it, so screens and hub can't
drift apart. The turbine count per feeder is a setting; the substation
single-line is drawn by hand, so the four feeders are fixed. See
[sim/README.md](../sim/README.md).

The display is one 1920×1080 screen. The shell doesn't fix a size, so each
project chooses its own.
