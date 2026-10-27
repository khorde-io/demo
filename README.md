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

You need [Node.js](https://nodejs.org) 24 or later with npm, and Docker (with
Compose) to run a hub. The repo also has a [devenv](https://devenv.sh) setup
with the right Node: `direnv allow` once, or `devenv shell`.

```bash
npm install
```

There are two ways to run the demo. Try it without a hub first: it takes one
command.

### Without a hub (one command)

```bash
npm run dev:mock
```

Open http://localhost:5174. The plant simulator runs in the browser behind a
mock backend, and you're signed in as an operator. Every screen, command,
interlock and alarm works, and the footer has a scenario picker (TR1 trip, oil
excursion, feeder trip…). Nothing is stored after you close the tab.

### With a Khorde hub

This runs the whole thing, as it would run on site: the HMI signs in through
the hub's identity provider and talks to its GraphQL API, and a simulator
drives two Khorde REST agents, one for the substation and one for the wind
farm.

```
 browser (HMI :5173) ──sign-in──▶ Khorde ID (auth.localhost:9310)
        │ GraphQL + WebSocket
        ▼
 Khorde hub (:8085) ◀──broker :4222── REST agents (:9091, :9092) ◀──▶ simulator (:8091)
```

The hub image is the free demo build from the
[Khorde quickstart](https://khorde.io/docs/quickstart). **It stops working
after about 2 hours**: sign-in fails with an error 500 and the screens go
stale. Restart it with `docker compose restart hub` in `hub/`; nothing is
lost.

Setting it up takes about 15 minutes, once. Steps 2–6 are done in the
hub's control plane; the Khorde guides explain each page in more detail.

**1. Start the hub.** `hub/docker-compose.yaml` is the
[quickstart](https://khorde.io/docs/quickstart) compose file, unchanged, so
if you already run a quickstart hub you can use it and skip this. Ports
`8085`, `4222`, `9310`, `5432` and `8812` must be free.

```bash
cd hub && docker compose up -d
```

Wait until `curl -f http://localhost:8085/health` answers, then open the
control plane at http://localhost:8085/ui/ (the trailing slash matters). Sign
in with the default admin from the
[quickstart](https://khorde.io/docs/quickstart); the identity provider asks
for a new password the first time.

`auth.localhost` resolves to your machine in Chrome, Firefox and Edge. If your
browser or OS doesn't resolve it, add `127.0.0.1 auth.localhost` to
`/etc/hosts`.

**2. Create the two agents.** In **Agents → New agent**, create
`vds-substation` and `vds-windfarm` (the names must be exactly these). Open
each one, click **Generate key** and save the downloaded file as:

```
sim/keys/vds-substation.json
sim/keys/vds-windfarm.json
```

The key is shown only once. `sim/keys/` is git-ignored. See
[Connect a REST agent](https://khorde.io/docs/guides/connect-a-rest-agent).

**3. Upload the plant's config.** In **Agents**, click **Upload config** and
pick `sim/site-config/vds-agents.yaml`. It holds both agents, keyed by name,
with every point, alarm, command and interlock of the plant. See
[Agent configuration](https://khorde.io/docs/guides/agent-configuration).

**4. Start the agents and the simulator.** Ports `9091`, `9092` and `8091`
must be free.

```bash
cd sim && docker compose up -d
```

Both agents should show **Online** and **configured** in **Agents** within
a few seconds. `curl localhost:8091/state` shows the simulated plant.

**5. Register the HMI.** In **Apps → New app**, create an app with redirect
URI and post-logout redirect URI both `http://localhost:5173/`, and turn on
**Dev mode** (needed for a plain `http://` address). It's a public PKCE
client, so there's no secret. Copy its client id. See
[Build your own HMI](https://khorde.io/docs/guides/build-an-hmi).

**6. Add users.** In **Users → Add user**, add one user per role you want to
try. The roles decide what the HMI offers, and the hub checks them again on
every call:

| User | Roles | Sees |
|---|---|---|
| Viewer | `ScadaViewer` | Every screen, no controls. |
| Operator | `ScadaViewer`, `ScadaOperator`, `ScadaAlarmAck` | Commands and alarm acknowledgement. |
| Supervisor | the operator's roles and `ScadaInterlockBypass` | Can also bypass an interlock. |

Note the passwords somewhere outside the repo. `hub/.local-credentials` is
git-ignored for this.

**7. Point the HMI at the hub.**

```bash
cp apps/demo-electrical/public/config.example.json apps/demo-electrical/public/config.json
```

Put the client id from step 5 in `auth.clientId`. `config.json` is
git-ignored. To use Khorde Cloud instead of a local hub, start from
`config.saas.example.json`.

**8. Run it.**

```bash
npm run dev
```

Open http://localhost:5173 (this address, since it's the registered redirect
URI) and sign in with one of the users from step 6. **Sign in as another
user** in the user menu switches between them.

#### Trying it out

- Trigger plant events on the simulator:
  `curl -X POST localhost:8091/scenario/tr1-trip`. The scenarios are listed in
  [sim/README.md](sim/README.md#scenarios). `normal` clears faults.
- Operate a breaker from its faceplate (click it on the substation
  single-line), acknowledge alarms, open a trend. Every action reaches the
  simulator through the agents: `docker compose logs -f simulator` in `sim/`.
- Sign in as the viewer and the supervisor to see what changes.

#### When something is wrong

| Symptom | Cause |
|---|---|
| Sign-in returns an error 500, or values turn stale and stop updating | The hub's 2-hour demo limit. `docker compose restart hub` in `hub/`. |
| "No SCADA role" after sign-in | The user has no `Scada*` role (step 6). |
| Redirected back to sign-in, or a redirect URI error | The HMI isn't on http://localhost:5173, or the app's redirect URIs or dev mode are wrong (step 5). |
| Agents show no config, or points show "?" | The config wasn't uploaded, or the agent names don't match (steps 2–3). |
| Agents stay offline | A key is missing from `sim/keys/`, or the hub isn't up. `docker compose logs agent-substation` in `sim/`. |
| The control plane is a blank page | Open `/ui/` with the trailing slash. |

To start over, `docker compose down` in `sim/` and `docker compose down -v`
in `hub/` (this wipes the identity provider and the databases), then repeat
from step 1.

The [sim README](sim/README.md) has the plant, the scenarios, the
simulator's settings and the performance-bench points.
`VITE_HMI_CONFIG` loads the HMI config from another path.

## Screens

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
