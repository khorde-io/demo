/**
 * Login with OIDC Authorization Code + PKCE (oidc-client-ts), token access for
 * the transport, and the user's SCADA roles.
 *
 * Roles only decide what the UI offers. The backend checks them again on every
 * call, so hiding a button is a convenience, not a security boundary.
 */

import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { Permission, Permissions } from "./commands.ts";
import type { HmiConfig } from "./config.ts";
import { writable, type Readable } from "./store.ts";

export const SCADA_ROLES = {
  viewer: "ScadaViewer",
  operator: "ScadaOperator",
  interlockBypass: "ScadaInterlockBypass",
  alarmAck: "ScadaAlarmAck",
} as const;

/** Scopes the SCADA API needs on the access token. */
export function requiredScopes(projectId: string): string[] {
  return [
    "openid",
    "profile",
    "email",
    `urn:zitadel:iam:org:project:id:${projectId}:aud`,
    "urn:zitadel:iam:org:projects:roles",
  ];
}

const ROLE_CLAIM = /^urn:zitadel:iam:org:project:(?:[^:]+:)?roles$/;

/**
 * Role names from the token. Zitadel's own claims map role → orgs
 * (`{ "RoleName": { orgId: domain } }`); the Khorde hub's token action also
 * writes a plain `roles` claim, as a list of names or the same map.
 */
export function rolesFromClaims(claims: Record<string, unknown>): Set<string> {
  const roles = new Set<string>();
  const add = (value: unknown) => {
    if (Array.isArray(value)) for (const r of value) roles.add(String(r));
    else if (typeof value === "object" && value !== null) for (const r of Object.keys(value)) roles.add(r);
  };
  for (const [key, value] of Object.entries(claims)) if (ROLE_CLAIM.test(key)) add(value);
  add(claims.roles);
  return roles;
}

/** Decodes a JWT payload without verifying it (the backend verifies). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const payload: unknown = JSON.parse(json);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function permissionsFor(roles: ReadonlySet<string>): Permissions {
  const operator = roles.has(SCADA_ROLES.operator);
  const table: Record<Permission, boolean> = {
    view: operator || roles.has(SCADA_ROLES.viewer),
    operate: operator,
    bypassInterlock: operator && roles.has(SCADA_ROLES.interlockBypass),
    // Acknowledging is its own role on the hub, independent of operating.
    ackAlarm: roles.has(SCADA_ROLES.alarmAck),
  };
  return { can: (p) => table[p] };
}

export interface AuthUser {
  sub: string;
  /** Best available display name. */
  name: string;
  email: string | null;
}

export interface AuthState {
  status: "loading" | "signedOut" | "signedIn" | "error";
  user: AuthUser | null;
  roles: ReadonlySet<string>;
  error: unknown;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "AuthRequiredError";
  }
}

/** The part of oidc-client-ts's UserManager this module uses (for tests). */
export interface UserManagerLike {
  getUser(): Promise<User | null>;
  signinRedirect(args?: { prompt?: string }): Promise<void>;
  signinRedirectCallback(): Promise<User>;
  signinSilent(): Promise<User | null>;
  signoutRedirect(): Promise<void>;
  removeUser(): Promise<void>;
  events: {
    addUserLoaded(cb: (user: User) => void): void;
    addUserUnloaded(cb: () => void): void;
    addAccessTokenExpired(cb: () => void): void;
  };
}

export interface Auth extends Readable<AuthState>, Permissions {
  /** Completes a login redirect if this page load is one, else restores the session. */
  init(): Promise<AuthState>;
  /**
   * Sends the user to the identity provider, which always shows its account
   * picker: with another live session in the browser (the control plane uses
   * the same IdP), it would otherwise sign in with that one without asking.
   * Also how to switch to another user while signed in.
   */
  login(): Promise<void>;
  /** Ends the session at the identity provider too (end-session endpoint), not just here. */
  logout(): Promise<void>;
  /** A valid access token, renewing it silently if needed. */
  getToken(): Promise<string>;
}

export interface AuthOptions {
  userManager?: UserManagerLike;
  location?: Pick<Location, "origin" | "pathname" | "search">;
  history?: Pick<History, "replaceState">;
}

function userManagerFor(auth: HmiConfig["auth"], origin: string): UserManagerLike {
  const redirect = auth.redirectUri ?? `${origin}/`;
  return new UserManager({
    authority: auth.authority,
    client_id: auth.clientId,
    redirect_uri: redirect,
    post_logout_redirect_uri: auth.postLogoutRedirectUri ?? redirect,
    response_type: "code",
    scope: [...requiredScopes(auth.projectId), ...(auth.extraScopes ?? [])].join(" "),
    automaticSilentRenew: true,
    revokeTokensOnSignout: true,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
}

const SIGNED_OUT: AuthState = { status: "signedOut", user: null, roles: new Set(), error: null };

export function createAuth(config: HmiConfig["auth"], options: AuthOptions = {}): Auth {
  const loc = options.location ?? window.location;
  const hist = options.history ?? window.history;
  const manager = options.userManager ?? userManagerFor(config, loc.origin);
  const state = writable<AuthState>({ ...SIGNED_OUT, status: "loading" });
  let current: User | null = null;

  const fromUser = (user: User | null): AuthState => {
    current = user && !user.expired ? user : null;
    if (!current) return SIGNED_OUT;
    const p = current.profile;
    const roles = rolesFromClaims({ ...(decodeJwtPayload(current.access_token) ?? {}), ...p });
    const name = String(p.name ?? p.preferred_username ?? p["username"] ?? p.email ?? p.sub);
    return { status: "signedIn", user: { sub: p.sub, name, email: p.email ?? null }, roles, error: null };
  };

  manager.events.addUserLoaded((u) => state.set(fromUser(u)));
  manager.events.addUserUnloaded(() => state.set(fromUser(null)));
  manager.events.addAccessTokenExpired(() => {
    manager.signinSilent().then(
      (u) => state.set(fromUser(u)),
      () => state.set(fromUser(null)),
    );
  });

  const perms = () => permissionsFor(state.get().roles);

  return {
    get: state.get,
    subscribe: state.subscribe,
    can: (p) => perms().can(p),

    async init() {
      try {
        const params = new URLSearchParams(loc.search);
        if (params.has("code") && params.has("state")) {
          const user = await manager.signinRedirectCallback();
          hist.replaceState({}, "", loc.pathname);
          state.set(fromUser(user));
        } else {
          state.set(fromUser(await manager.getUser()));
        }
      } catch (error) {
        state.set({ ...SIGNED_OUT, status: "error", error });
      }
      return state.get();
    },

    login: () => manager.signinRedirect({ prompt: "select_account" }),

    async logout() {
      await manager.signoutRedirect();
    },

    async getToken() {
      if (current && !current.expired) return current.access_token;
      try {
        const renewed = await manager.signinSilent();
        state.set(fromUser(renewed));
      } catch {
        state.set(fromUser(null));
      }
      if (current) return current.access_token;
      throw new AuthRequiredError();
    },
  };
}
