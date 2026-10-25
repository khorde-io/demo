# Ventos da Serra demo plant

The demo plant for the HMI: a 108 MW wind complex (24 × 4.5 MW turbines on 4
collector feeders) and its 34.5/138 kV substation (2 × 60 MVA transformers, a
split 34.5 kV bus with a bus coupler).

| Path | What |
|---|---|
| `src/plant.ts` | The plant description: topology, points, alarms, commands and interlocks. Everything else is derived from it. |
| `site-config/vds-agents.yaml` | **Generated.** The agent config for both REST agents, uploaded to the hub. |
| `site-config/agent-config.schema.json` | Copy of `https://schemas.khorde.io/v1/agent-config.json`, used by the tests. |
| `src/sim/` | The simulator: plant model, field layer, `/batch` publisher, command webhook. The model steps once a second; the field layer reports each point like an RTU would: analog values on their own scan (0.8–1.6 s electrical, 2–4 s turbine, 5–10 s temperatures, random phase) past a deadband, discrete changes as events 20–400 ms later, and every point again on its own 30–60 s integrity period. Each value carries its acquisition time. |
| `agents/*.yaml` | Runtime settings of each REST agent container (broker, auth, webhook). |
| `docker-compose.yaml` | Both REST agents and the simulator. |
| `keys/` | Service-account keys from the control plane. Git-ignored. |

The plant is split over two agents, so the HMI can show agent health per area:

| Agent | Equipment | Points |
|---|---|---|
| `vds-substation` | `vds.sub.>` (buses, line bay, transformers, incomers, coupler, feeders) | 112 measurements, 61 alarms, 64 commands, 46 interlocks |
| `vds-windfarm` | `vds.wf.>` (turbines `vds.wf.f1.t01` … `vds.wf.f4.t24`, met mast) | 338 measurements, 96 alarms, 96 commands, 48 interlocks |

Turbines are numbered 01–24 across the farm (F1 has T01–T06, F2 has T07–T12…).

## Running against a local hub

You need the local hub running on this machine. `hub/` in this repo has the
khorde.io quickstart setup, moved to free ports (broker on `:4223`, IdP on
`auth.localhost:9311`) so it can run next to another local stack:

```bash
cd hub && docker compose up -d
```

The control plane is then at http://localhost:8085/ui/ (note the trailing
slash). Default admin `admin@khorde.io`; the IdP asks for a new password on
first login.

1. **Create the agents.** In the control plane, create two agents named
   exactly `vds-substation` and `vds-windfarm`, generate a service-account key
   for each and save them as:

   ```
   sim/keys/vds-substation.json
   sim/keys/vds-windfarm.json
   ```

2. **Upload the config.** Upload `site-config/vds-agents.yaml`. It holds both
   agents, keyed by name. If the control plane takes one agent per upload,
   upload each agent's section on its own.

3. **Start the agents and the simulator.**

   ```bash
   cd sim
   docker compose up -d
   docker compose logs -f simulator
   ```

   The simulator starts in the `showcase` state: T09 stopped, T14 in fault,
   T22 silent (bad quality), low SF6 on the F2 breaker and a warm TR2.

4. **Create the HMI's OIDC application** (for the next phase): a public
   PKCE app with dev mode on, redirect URI and logout URL both
   `http://localhost:5173/`. Give the test users the roles
   `ScadaViewer`, `ScadaOperator` and, for one of them, `ScadaInterlockBypass`.

## Scenarios

Trigger them on the simulator's control port:

```bash
curl -X POST localhost:8091/scenario/tr1-trip
```

| Scenario | What happens |
|---|---|
| `showcase` | The state shown in the mockups (see above). |
| `normal` | Clears faults, comms loss, protection flags and extra heat. Breakers that tripped stay open until an operator closes them. |
| `tr1-trip` | Buchholz trip on TR1: both its breakers open and bus A goes dead. Recover by closing the bus coupler (TR2 then carries the whole farm, so curtail first or TR2 trips on overload after 30 s above 110 %). |
| `oil-excursion` | TR2 oil temperature climbs into its high alarms. |
| `feeder-trip` | The F3 breaker trips. |
| `turbine-fault` | A producing turbine goes to fault. |
| `comms-loss` / `comms-restore` | T22 stops reporting (values freeze with bad quality) and comes back. |

`GET localhost:8091/state` shows a few key values. Commands from the HMI
reach the simulator through the agents' webhook; `docker compose logs
simulator` shows each one and whether it was accepted.

### Settings

Set these in the environment of `docker compose up`:

| Variable | Default | |
|---|---|---|
| `TURBINES_PER_FEEDER` | `6` | Must match the uploaded config. Regenerate it with `TURBINES_PER_FEEDER=15 npm run gen -w @khorde/demo-plant`. |
| `SCENARIO` | `showcase` | Initial state. |
| `THERMAL_SPEED` | `10` | Transformer temperatures move this many times faster than real time. |

## Changing the plant

Edit `src/plant.ts`, then:

```bash
npm run gen -w @khorde/demo-plant
npm run check
```

The tests validate both agents against the schema, check that every alarm,
command and interlock refers to a point or interlock of the same agent, and
fail if `site-config/vds-agents.yaml` is out of date.

Running the simulator without Docker (for example against agents on the host
ports):

```bash
SUBSTATION_AGENT_URL=http://localhost:9091 WINDFARM_AGENT_URL=http://localhost:9092 npm run sim -w @khorde/demo-plant
```

The agents' webhook then has to point at the host
(`http://host.docker.internal:8091/webhook` in `agents/*.yaml`).
