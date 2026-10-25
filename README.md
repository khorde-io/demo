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
npm run dev
```

The demo runs at http://localhost:5173.

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
