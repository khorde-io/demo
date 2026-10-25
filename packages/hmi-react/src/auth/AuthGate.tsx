/**
 * Sign-in, session-expired and no-access screens, and the gate that picks
 * between them and the HMI. These screens are application chrome, so they may
 * use the brand accent (ISA-101 keeps it out of process graphics only).
 */

import "./auth.css";
import { useState, type ReactNode } from "react";
import type { Auth, AuthState } from "@khorde/hmi-core";
import { useI18n, useReadable } from "../context.tsx";

export interface AuthScreenProps {
  site: string;
  logo?: ReactNode;
}

function Screen({ logo, title, children }: { logo?: ReactNode; title: string; children: ReactNode }) {
  return (
    <main className="kh-auth">
      <section className="kh-auth-card" aria-labelledby="kh-auth-title">
        {logo}
        <h1 id="kh-auth-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function LoginScreen({ site, logo, onSignIn, failed = false, busy = false }: AuthScreenProps & { onSignIn: () => void; failed?: boolean; busy?: boolean }) {
  const i18n = useI18n();
  return (
    <Screen logo={logo} title={i18n.t("auth.title", { site })}>
      <p>{i18n.t("auth.intro")}</p>
      {failed && (
        <p className="kh-auth-error" role="alert">
          {i18n.t("auth.failed")}
        </p>
      )}
      <button type="button" className="kh-auth-btn" onClick={onSignIn} disabled={busy}>
        {busy ? i18n.t("auth.loading") : i18n.t("auth.signIn")}
      </button>
    </Screen>
  );
}

export function SessionExpired({ logo, onSignIn }: Omit<AuthScreenProps, "site"> & { onSignIn: () => void }) {
  const i18n = useI18n();
  return (
    <Screen logo={logo} title={i18n.t("auth.expiredTitle")}>
      <p>{i18n.t("auth.expiredBody")}</p>
      <button type="button" className="kh-auth-btn" onClick={onSignIn}>
        {i18n.t("auth.signInAgain")}
      </button>
    </Screen>
  );
}

export function AccessDenied({ logo, name, onSignOut }: Omit<AuthScreenProps, "site"> & { name: string; onSignOut: () => void }) {
  const i18n = useI18n();
  return (
    <Screen logo={logo} title={i18n.t("auth.deniedTitle")}>
      <p>{i18n.t("auth.deniedBody", { name })}</p>
      <button type="button" className="kh-auth-btn kh-auth-btn--quiet" onClick={onSignOut}>
        {i18n.t("auth.signOut")}
      </button>
    </Screen>
  );
}

export type GateView = "loading" | "login" | "loginFailed" | "expired" | "denied" | "open";

/** Which screen to show. A sign-out after having been signed in reads as an expired session. */
export function gateView(state: AuthState, wasSignedIn: boolean, canView: boolean): GateView {
  if (state.status === "loading") return "loading";
  if (state.status === "error") return "loginFailed";
  if (state.status === "signedOut") return wasSignedIn ? "expired" : "login";
  return canView ? "open" : "denied";
}

export function AuthGate({ auth, site, logo, children }: AuthScreenProps & { auth: Auth; children: ReactNode }) {
  const state = useReadable(auth);
  // Remembered across renders: a later sign-out then reads as an expired session.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  if (state.status === "signedIn" && !wasSignedIn) setWasSignedIn(true);
  const view = gateView(state, wasSignedIn, auth.can("view"));
  const signIn = () => void auth.login();
  switch (view) {
    case "loading":
      return <LoginScreen site={site} logo={logo} onSignIn={signIn} busy />;
    case "login":
    case "loginFailed":
      return <LoginScreen site={site} logo={logo} onSignIn={signIn} failed={view === "loginFailed"} />;
    case "expired":
      return <SessionExpired logo={logo} onSignIn={signIn} />;
    case "denied":
      return <AccessDenied logo={logo} name={state.user?.name ?? ""} onSignOut={() => void auth.logout()} />;
    default:
      return <>{children}</>;
  }
}
