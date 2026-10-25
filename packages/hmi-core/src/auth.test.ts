import type { User } from "oidc-client-ts";
import { describe, expect, it, vi } from "vitest";
import {
  AuthRequiredError,
  SCADA_ROLES,
  createAuth,
  decodeJwtPayload,
  permissionsFor,
  requiredScopes,
  rolesFromClaims,
  type UserManagerLike,
} from "./auth.ts";

const roleClaim = (...roles: string[]) => Object.fromEntries(roles.map((r) => [r, { "123": "khorde.localhost" }]));

describe("roles", () => {
  it("reads Zitadel role claims, generic and project-specific", () => {
    const roles = rolesFromClaims({
      sub: "1",
      "urn:zitadel:iam:org:project:roles": roleClaim(SCADA_ROLES.operator),
      "urn:zitadel:iam:org:project:khorde_scada:roles": roleClaim(SCADA_ROLES.interlockBypass),
      "urn:zitadel:iam:org:project:id:khorde_scada:aud": "x",
    });
    expect([...roles].sort()).toEqual([SCADA_ROLES.interlockBypass, SCADA_ROLES.operator]);
  });

  it("maps roles to permissions", () => {
    const viewer = permissionsFor(new Set([SCADA_ROLES.viewer]));
    expect([viewer.can("view"), viewer.can("operate"), viewer.can("bypassInterlock")]).toEqual([true, false, false]);
    const op = permissionsFor(new Set([SCADA_ROLES.operator]));
    expect([op.can("view"), op.can("operate"), op.can("bypassInterlock")]).toEqual([true, true, false]);
    const bypass = permissionsFor(new Set([SCADA_ROLES.operator, SCADA_ROLES.interlockBypass]));
    expect(bypass.can("bypassInterlock")).toBe(true);
    expect(permissionsFor(new Set([SCADA_ROLES.interlockBypass])).can("bypassInterlock")).toBe(false);
  });

  it("requests the SCADA audience and role scopes", () => {
    expect(requiredScopes("khorde_scada")).toContain("urn:zitadel:iam:org:project:id:khorde_scada:aud");
    expect(requiredScopes("khorde_scada")).toContain("urn:zitadel:iam:org:projects:roles");
  });

  it("decodes a JWT payload and ignores opaque tokens", () => {
    const payload = { sub: "1", "urn:zitadel:iam:org:project:roles": roleClaim("ScadaViewer") };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(decodeJwtPayload(`h.${b64}.s`)).toEqual(payload);
    expect(decodeJwtPayload("opaque-token")).toBeNull();
  });
});

const user = (over: Partial<{ expired: boolean; token: string; roles: string[] }> = {}): User =>
  ({
    access_token: over.token ?? "access-1",
    expired: over.expired ?? false,
    profile: { sub: "u1", name: "Ana Operator", email: "ana@example.test", "urn:zitadel:iam:org:project:roles": roleClaim(...(over.roles ?? [SCADA_ROLES.operator])) },
  }) as unknown as User;

function fakeManager(initial: User | null) {
  const listeners: { loaded: ((u: User) => void)[] } = { loaded: [] };
  const m: UserManagerLike = {
    getUser: vi.fn(async () => initial),
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(async () => user()),
    signinSilent: vi.fn(async () => user({ token: "access-2" })),
    signoutRedirect: vi.fn(async () => {}),
    removeUser: vi.fn(async () => {}),
    events: {
      addUserLoaded: (cb) => listeners.loaded.push(cb),
      addUserUnloaded: () => {},
      addAccessTokenExpired: () => {},
    },
  };
  return m;
}

const location = (search = "") => ({ origin: "http://localhost:5173", pathname: "/", search });
const history = { replaceState: vi.fn() };

describe("createAuth", () => {
  it("restores an existing session with roles", async () => {
    const auth = createAuth({ authority: "http://idp", clientId: "c", projectId: "p" }, { userManager: fakeManager(user()), location: location(), history });
    const state = await auth.init();
    expect(state).toMatchObject({ status: "signedIn", user: { sub: "u1", name: "Ana Operator" } });
    expect(auth.can("operate")).toBe(true);
    await expect(auth.getToken()).resolves.toBe("access-1");
  });

  it("completes a login redirect and cleans the URL", async () => {
    const manager = fakeManager(null);
    const auth = createAuth({ authority: "http://idp", clientId: "c", projectId: "p" }, { userManager: manager, location: location("?code=x&state=y"), history });
    await auth.init();
    expect(manager.signinRedirectCallback).toHaveBeenCalled();
    expect(history.replaceState).toHaveBeenCalledWith({}, "", "/");
    expect(auth.get().status).toBe("signedIn");
  });

  it("renews an expired token silently", async () => {
    const auth = createAuth({ authority: "http://idp", clientId: "c", projectId: "p" }, { userManager: fakeManager(user({ expired: true })), location: location(), history });
    await auth.init();
    expect(auth.get().status).toBe("signedOut");
    await expect(auth.getToken()).resolves.toBe("access-2");
    expect(auth.get().status).toBe("signedIn");
  });

  it("throws AuthRequiredError when renewal fails", async () => {
    const manager = fakeManager(null);
    manager.signinSilent = vi.fn(async () => {
      throw new Error("login_required");
    });
    const auth = createAuth({ authority: "http://idp", clientId: "c", projectId: "p" }, { userManager: manager, location: location(), history });
    await auth.init();
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("grants nothing to a user without SCADA roles", async () => {
    const auth = createAuth({ authority: "http://idp", clientId: "c", projectId: "p" }, { userManager: fakeManager(user({ roles: [] })), location: location(), history });
    await auth.init();
    expect(auth.can("view")).toBe(false);
  });
});
