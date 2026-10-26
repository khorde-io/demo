# Local hub

The [khorde.io quickstart](https://khorde.io/docs/quickstart) hub ("Run the
Hub locally"), for running the demo. It uses the IdP on `auth.localhost:9311`
and the broker on host port `4223`, so it can run next to another local Khorde
stack. The step-by-step setup is in the main [README](../README.md#with-a-khorde-hub).

The image is the demo build, which stops working after about 2 hours (sign-in
returns an error 500, values go stale). `docker compose restart hub` brings it
back without losing anything.

```bash
docker compose up -d        # control plane: http://localhost:8085/ui/
docker compose restart hub  # after the demo build's 2-hour limit
docker compose down -v      # start over: wipes the IdP and the databases
```

Once set up, the hub has (redo it after `down -v`):

- Agents `vds-substation` and `vds-windfarm`, keys in `sim/keys/`, config from
  `sim/site-config/vds-agents.yaml`.
- App "Ventos da Serra HMI (dev)": public PKCE client, dev mode, redirect and
  post-logout URI `http://localhost:5173/`.
- Test users `viewer@vds.test`, `operator@vds.test`, `supervisor@vds.test`.

Keep the passwords and the client id in `.local-credentials` here, which is
git-ignored.
