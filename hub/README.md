# Local hub

The khorde.io quickstart hub ("Run the Hub locally"), for developing the demo.
It uses the IdP on `auth.localhost:9311` and the broker on host port `4223`,
so it can run next to another local Khorde stack.

```bash
docker compose up -d      # control plane: http://localhost:8085/ui/
docker compose down -v    # start over: wipes the IdP and the databases
```

What is provisioned on it (redo these after `down -v`; see `sim/README.md`):

- Agents `vds-substation` and `vds-windfarm`, keys in `sim/keys/`, config from
  `sim/site-config/vds-agents.yaml`.
- App "Ventos da Serra HMI (dev)": public PKCE client, dev mode, redirect and
  post-logout URI `http://localhost:5173/`.
- Test users `viewer@vds.test`, `operator@vds.test`, `supervisor@vds.test`.

Passwords and the client id are in `.local-credentials` (git-ignored).
