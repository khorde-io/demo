// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { writable, type Auth, type AuthState } from "@khorde/hmi-core";
import { mount } from "../test-dom.tsx";
import { AuthGate } from "./AuthGate.tsx";

const signedOut: AuthState = { status: "signedOut", user: null, roles: new Set(), error: null };
const accounts = [{ role: "supervisor" as const, username: "supervisor@vds.test", password: "bypass-ok" }];

describe("demo sign-in", () => {
  it("sends the visitor to the provider with the account filled in, or to its picker", async () => {
    const login = vi.fn(async () => {});
    const auth = { ...writable(signedOut), can: () => false, init: async () => signedOut, login, logout: async () => {}, getToken: async () => "" } as Auth;
    const m = await mount(
      <AuthGate auth={auth} site="VDS" demoAccounts={accounts}>
        hmi
      </AuthGate>,
    );
    await m.click(m.button("Sign in as Supervisor"));
    expect(login).toHaveBeenLastCalledWith("supervisor@vds.test");
    await m.click(m.button("Sign in with your own Khorde ID"));
    expect(login).toHaveBeenLastCalledWith(undefined);
    m.unmount();
  });

  it("copies the password, and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const auth = { ...writable(signedOut), can: () => false, init: async () => signedOut, login: async () => {}, logout: async () => {}, getToken: async () => "" } as Auth;
    const m = await mount(
      <AuthGate auth={auth} site="VDS" demoAccounts={accounts}>
        hmi
      </AuthGate>,
    );
    await m.click(m.button("Copy the Supervisor password"));
    await m.settle();
    expect(writeText).toHaveBeenCalledWith("bypass-ok");
    expect(m.container.textContent).toContain("Copied");
    m.unmount();
  });

  it("selects the value for the visitor when the browser won't let it copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    const auth = { ...writable(signedOut), can: () => false, init: async () => signedOut, login: async () => {}, logout: async () => {}, getToken: async () => "" } as Auth;
    const m = await mount(
      <AuthGate auth={auth} site="VDS" demoAccounts={accounts}>
        hmi
      </AuthGate>,
    );
    await m.click(m.button("Copy the Supervisor password"));
    await m.settle();
    expect(window.getSelection()?.toString()).toBe("bypass-ok");
    m.unmount();
  });

  it("says so when the identity provider can't be reached", async () => {
    const auth = { ...writable(signedOut), can: () => false, init: async () => signedOut, login: vi.fn(async () => Promise.reject(new Error("Failed to fetch"))), logout: async () => {}, getToken: async () => "" } as Auth;
    const m = await mount(
      <AuthGate auth={auth} site="VDS" demoAccounts={accounts}>
        hmi
      </AuthGate>,
    );
    await m.click(m.button("Sign in as Supervisor"));
    await m.settle();
    expect(m.container.textContent).toContain("Sign-in failed. Try again.");
    m.unmount();
  });
});
