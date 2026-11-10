# Notes for coding agents

The Khorde demo HMI: a showcase and a reference implementation for HMIs on
the Khorde GraphQL API. Read [README.md](README.md) for running it and
[docs/architecture.md](docs/architecture.md) for how it is built.

## Commands

The toolchain comes from devenv. Outside a devenv shell, wrap commands:

```bash
devenv shell -- bash -c 'npm run check'
```

| Command | What |
|---|---|
| `npm run check` | Lint, typecheck of every package, and all tests. Run it before saying a change is done. |
| `npm run dev:mock` | The demo on the in-browser simulator, at :5174. No hub needed. |
| `npm run dev` | The demo against a hub, at :5173 (the registered redirect URI). |
| `npm run release` | A production build against a hub, served at :5173. Rebuild to pick up a changed `config.json`. |
| `npm run build:public -w @khorde/demo-electrical` | The build for a public demo: no benches or symbol sheet. See [docs/public-demo.md](docs/public-demo.md). |
| `deploy/build-image.sh` | Builds the public demo images (HMI and simulator) and pushes them to the registry in `deploy/registry.env`. `--only hmi\|sim` builds one, `--local` doesn't push. |
| `npm run gen` | Regenerates the agent configs from `sim/src/plant.ts`. A test fails if they are out of date. |

## Where code goes

- **Libraries** (`packages/hmi-core`, `hmi-theme`, `hmi-react`) hold anything
  another plant could reuse. `hmi-core` must not import React.
- **The project layer** (`apps/demo-electrical`) holds only what is specific
  to Ventos da Serra: wiring, dictionary, screens, faceplates. When a piece of
  it turns out to be generic, move it into a library.
- **The plant** is described once, in `sim/src/plant.ts`. Point ids, the
  agent config, the simulator and the equipment list all come from it.
- Every GraphQL operation is in `hmi-core/src/graphql/documents.ts`, which is
  validated against `schema.graphql`.
- Tests sit next to the code (`*.test.ts`, `*.test.tsx`). The mock backend
  (`@khorde/hmi-core/mock`) stands in for the hub in tests.

## Rules the checks don't catch

- **Every word on screen comes from a catalog**: the library's `messages.ts`
  / `i18n/en.ts`, or the project's `dictionary.ts`. The API sends ids only.
- **ISA-101:** process graphics are grey. Colour is only for alarms (P1 to
  P3) and interlocks (violet). The brand lime is only for the chrome. State
  is shown by shape as well as lightness. Components use semantic tokens,
  never raw colours. See [docs/isa-101.md](docs/isa-101.md).
- **Accessibility:** a control's name comes from its visible content, with
  `kh-sr-only` text added where needed. Decorative badges are `aria-hidden`.
  `src/screens/a11y.test.tsx` runs axe on every screen. See
  [docs/accessibility.md](docs/accessibility.md).
- **Performance:** a screen watches only the points it shows; never
  subscribe per symbol. See [docs/performance.md](docs/performance.md).
- **The UI never decides on authority.** Roles only hide or disable actions;
  the API checks them again.
- Match the surrounding code: its comment density (a short block comment on
  each module and exported function, little inline), naming and idiom.
- Commit messages: a short sentence in the imperative saying what changes for
  the user ("Show each command's interlock state on its button"), then a body
  saying why.

## Gotchas

- Vite reads package `exports` at startup. Restart the dev server after
  changing them.
- The demo hub stops working after about 2 hours: sign-in returns a 500 and
  values go stale. `docker compose restart hub` in `hub/`.
- History is paged, for measurements and alarms alike: a backend `history`
  or `alarmJournal` call returns one `Page` (items and the `next` cursor),
  and `collectPages` (`hmi-core/src/pages.ts`) follows them. The mock backend
  pages the same way, so tests catch a missed page.
- Never commit `apps/demo-electrical/public/config.json`, `sim/keys/` or
  `hub/.local-credentials`. They are git-ignored.
