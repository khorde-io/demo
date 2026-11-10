# Running a public demo

How to put the demo on the internet for anyone to try against a real hub,
with shared accounts. Three things differ from a private setup: the build
leaves out the development pages, the simulator has no performance generator,
and the sign-in screen offers the shared accounts.

## The build

```bash
npm run build:public -w @khorde/demo-electrical
```

This is the normal production build with `VITE_DEV_PAGES=false`. The
performance bench, the interlock bench and the symbol sheet are not in it at
all, not just hidden: their links and routes are gone, and so is their code.
The bench can push thousands of values a second through the hub, so a public
build must not have it.

`config.json` is read when the page loads, so one build works anywhere.

## The images

[deploy/](../deploy) holds two images: the HMI, which is that build behind
nginx, and the plant simulator, on Node. They are separate because only the
HMI is public, and because redeploying it mustn't restart the simulator (which
resets the plant for everyone). Set the registry once, sign in, and build both:

```bash
cp deploy/registry.env.example deploy/registry.env
```

```bash
docker login registry.example.com
```

```bash
deploy/build-image.sh
```

They are `khorde-demo-hmi` and `khorde-demo-sim` (`IMAGE_NAME` and
`SIM_IMAGE_NAME` change them), tagged with the short commit and also `latest`.
A tree with uncommitted changes gets `<commit>-dirty` and leaves `latest`
alone. `--only hmi` or `--only sim` builds one, `--tag v1` picks the tag, and
`--local` builds into the local Docker without pushing. They're built for
`linux/amd64`; set `PLATFORMS` for anything else.

To run the HMI:

- **Mount the deployment's `config.json`** at
  `/usr/share/nginx/html/config.json` (in Kubernetes, from a ConfigMap, or a
  Secret since it holds the accounts). The image has none, so without it the
  page can't start. Mount it as a single file (`subPath`).
- It listens on **8080** as a non-root user, and runs with a read-only root
  filesystem as long as `/tmp` is writable.
- `/healthz` is there for the cluster's probes.

## The simulator and agents

- The simulator image runs with `PERF=off` already. It then has no `/perf`
  routes and no generator, whatever reaches it. It listens on **8091** as a
  non-root user and runs with a read-only root filesystem. `GET /state`
  answers the cluster's probes.
- It expects the agents at `http://agent-substation:9090` and
  `http://agent-windfarm:9090`, and the agents' configs
  ([sim/agents/](../sim/agents)) call it back at
  `http://simulator:8091/webhook`. Name the Services `simulator`,
  `agent-substation` and `agent-windfarm` and none of that changes; otherwise
  set `SUBSTATION_AGENT_URL` and `WINDFARM_AGENT_URL`, and the webhook in the
  agents' configs. Their broker and auth URLs have to point at the hub in the
  cluster.
- The agents run the stock `khorde/rest-agent` image with their config
  mounted at `/opt/agent/config.yaml` and their service-account key, from a
  Secret, at `/opt/agent/service-user.json`.
- Run one simulator: it holds the plant's state. The HMI can scale.
- Keep the simulator and the agents off the internet: no ingress for them.
  The agents reach the hub and the simulator's webhook, the simulator reaches
  the agents, and nothing else needs to reach either. `/scenario` stays
  internal too: anyone who reaches it can change the plant.
- `TURBINES_PER_FEEDER` (6) must match the config uploaded to the hub. Upload
  `sim/site-config/vds-agents.yaml`, never the perf variant.

## The shared accounts

Add a `demo` block to the deployment's `config.json`
([config.public.example.json](../apps/demo-electrical/public/config.public.example.json)):

```json
"demo": {
  "accounts": [
    { "role": "viewer", "username": "viewer@your-domain", "password": "…" },
    { "role": "operator", "username": "operator@your-domain", "password": "…" },
    { "role": "supervisor", "username": "supervisor@your-domain", "password": "…" }
  ]
}
```

With it, the sign-in screen:

- lists the accounts, what each role may do, and their user names and
  passwords, each with a Copy button;
- says the accounts and the plant are shared, so other visitors may be
  operating it at the same time;
- sends the visitor to the identity provider with the user name filled in
  (`login_hint`), so they only paste the password;
- comes back to the list when a visitor signs out or switches user, instead of
  the provider's account picker.

The footer also says the plant is shared, on every screen.

These passwords are public by design: the accounts must hold only the demo
roles below, on a hub that holds nothing but the demo. `config.json` is
git-ignored, so the passwords stay out of the repository.

| Role | Roles in the identity provider |
|---|---|
| `viewer` | `ScadaViewer` |
| `operator` | `ScadaViewer`, `ScadaOperator`, `ScadaAlarmAck` |
| `supervisor` | the operator's, plus `ScadaInterlockBypass` |

### Identity provider settings

Shared accounts only work if no visitor can take one away from the others. In
Zitadel, for the demo organization:

- **No second factor:** MFA not required, and visitors can't add one.
- **No self-service changes:** visitors can't change the password, email or
  profile of a demo account.
- **No lockout:** set the maximum password attempts to 0. Otherwise anyone can
  lock an account for everyone by failing to sign in on purpose.
- **No registration:** visitors use the shared accounts only.
- Register the public URL of the HMI as a redirect URI, and as the post-logout
  redirect URI.

It's worth checking every so often that the accounts still sign in.
