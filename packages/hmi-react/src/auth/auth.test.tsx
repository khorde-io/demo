import { describe, expect, it } from "vitest";
import { writable, type Auth, type AuthState } from "@khorde/hmi-core";
import { render } from "../test-render.tsx";
import { AuthGate, gateView } from "./AuthGate.tsx";

const state = (status: AuthState["status"], name = "Vera Viewer"): AuthState => ({
  status,
  user: status === "signedIn" ? { sub: "1", name, email: null } : null,
  roles: new Set(),
  error: null,
});

describe("auth gate", () => {
  it("chooses the screen", () => {
    expect(gateView(state("loading"), false, false)).toBe("loading");
    expect(gateView(state("signedOut"), false, false)).toBe("login");
    expect(gateView(state("signedOut"), true, false)).toBe("expired");
    expect(gateView(state("error"), false, false)).toBe("loginFailed");
    expect(gateView(state("signedIn"), false, false)).toBe("denied");
    expect(gateView(state("signedIn"), false, true)).toBe("open");
  });

  const fakeAuth = (s: AuthState, canView: boolean): Auth =>
    ({ ...writable(s), can: () => canView, init: async () => s, login: async () => {}, logout: async () => {}, getToken: async () => "" }) as Auth;

  it("shows sign-in, no-access or the HMI", () => {
    expect(render(<AuthGate auth={fakeAuth(state("signedOut"), false)} site="Ventos da Serra">hmi</AuthGate>)).toContain("Sign in to Ventos da Serra");
    const denied = render(<AuthGate auth={fakeAuth(state("signedIn"), false)} site="VDS">hmi</AuthGate>);
    expect(denied).toContain("No access to this HMI");
    expect(denied).toContain("Vera Viewer");
    expect(render(<AuthGate auth={fakeAuth(state("signedIn"), true)} site="VDS">hmi</AuthGate>)).toBe("hmi");
  });
});
