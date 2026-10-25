/** A signed-in user with fixed roles, for running without an identity provider. */

import { permissionsFor, type Auth, type AuthState } from "../auth.ts";
import { writable } from "../store.ts";

export function createStaticAuth(options: { sub?: string; name?: string; roles: readonly string[] }): Auth {
  const signedIn: AuthState = {
    status: "signedIn",
    user: { sub: options.sub ?? "mock-user", name: options.name ?? "Mock operator", email: null },
    roles: new Set(options.roles),
    error: null,
  };
  const state = writable<AuthState>(signedIn);
  return {
    get: state.get,
    subscribe: state.subscribe,
    can: (p) => permissionsFor(state.get().roles).can(p),
    init: async () => state.get(),
    login: async () => state.set(signedIn),
    logout: async () => state.set({ status: "signedOut", user: null, roles: new Set(), error: null }),
    getToken: async () => "mock-token",
  };
}
