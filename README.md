# Khorde demo HMI

A demo and reference HMI for the Khorde SCADA, built for the electrical sector
(a wind farm and its 34.5/138 kV substation). See [PLAN.md](PLAN.md) for the
design.

## Layout

| Path | What |
|---|---|
| `packages/hmi-theme` | `@khorde/hmi-theme`: Khorde brand tokens, the HMI scale and the built-in themes (`dark-grey`, `range-green`, `ink`), plus the theme contract check. |
| `packages/hmi-core` | `@khorde/hmi-core`: framework-agnostic core (auth, transport, points, alarms, commands…). |
| `packages/hmi-react` | `@khorde/hmi-react`: React hooks, application shell, widgets and symbols. |
| `apps/demo-electrical` | The customer layer: screens, faceplates and menus for the demo plant. |
| `sim` | `@khorde/demo-plant`: the demo plant description, its generated agent config, and the simulator with its Docker setup. See [sim/README.md](sim/README.md). |

## Getting started

The toolchain comes from [devenv](https://devenv.sh). With direnv, `cd` into
the repo and allow it once:

```bash
direnv allow
```

Without direnv, open a shell with the tools:

```bash
devenv shell
```

Then:

```bash
npm install
```

The demo runs in one of two ways.

**Without a hub**, the plant simulator runs in the browser behind a mock
backend, signed in as an operator, with a scenario picker in the footer:

```bash
npm run dev:mock
```

It runs at http://localhost:5174.

**Against a hub**, the app reads `apps/demo-electrical/public/config.json`
(git-ignored) for the identity provider, the client id of the HMI app and the
API. Copy `config.example.json` (local hub, see [hub/README.md](hub/README.md))
or `config.saas.example.json`, fill in the client id, then:

```bash
npm run dev
```

It runs at http://localhost:5173, the redirect URI registered for the app. Run
the simulator and the REST agents too ([sim/README.md](sim/README.md)), and
sign in with a user that has a SCADA role. `VITE_HMI_CONFIG` loads the config
from another path.

### Screens

| Route | Level | Screen |
|---|---|---|
| `#overview` | L1 | Export against what the wind allows, grid connection, wind, alarms by area, feeders and transformer loading, the day's export. |
| `#substation` | L2 | The 138/34.5 kV single-line, energized from the measured voltages. Every device and transformer opens its faceplate. |
| `#windfarm` | L2 | Turbine tiles by collector feeder, laid out from the plant description. |
| `#alarms`, `#events` | L4 | The live alarm list (ack here) and the event log over a chosen range. |
| `#trends`, `#comms` | L4 | Trends, and the health of the hub link, the agents and each turbine's link. |

Adding `/<equipment id>` opens that equipment's faceplate (bay, transformer or
turbine), for example `#substation/vds.sub.mv.a.f1.cb` or
`#windfarm/vds.wf.f3.t14`. The footer links to the symbol sheet, the
interlock bench and the performance bench.

## Docs

- [Build your own HMI](docs/build-your-own-hmi.md): from an empty app to live screens, commands, alarms and trends.
- [ISA-101 rationale](docs/isa-101.md): the visual and interaction choices, and why.
- [Accessibility](docs/accessibility.md): what is checked, the last audit, and how to run it.
- [Performance](docs/performance.md): the 1,000-points-at-1-Hz target, results, and the bench.

## Checks

```bash
npm run check
```

That runs `oxlint`, the TypeScript typecheck of every package, and the Vitest
suite (which includes the theme contract: every theme defines every token and
meets the contrast rules).

## Adding a theme

1. Add `packages/hmi-theme/src/themes/<id>.css` that sets every token in
   `THEME_TOKENS` under `[data-theme="<id>"]`.
2. Register it in `THEMES` in `packages/hmi-theme/src/index.ts` and import it in
   `src/index.css`.
3. Run `npm test`; the contract test lists anything missing or too low in
   contrast.
