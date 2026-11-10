/**
 * Sign-in, session-expired and no-access screens, and the gate that picks
 * between them and the HMI. These screens are application chrome, so they may
 * use the brand accent (ISA-101 keeps it out of process graphics only).
 *
 * In a public demonstration the sign-in screen lists the shared accounts with
 * their passwords, says the plant is shared, and sends each visitor to the
 * identity provider with the account's name filled in.
 */

import "./auth.css";
import { useRef, useState, type ReactNode } from "react";
import type { Auth, AuthState, DemoAccount } from "@khorde/hmi-core";
import { useI18n, useReadable } from "../context.tsx";

export interface AuthScreenProps {
  site: string;
  logo?: ReactNode;
}

function Screen({ logo, title, wide = false, children }: { logo?: ReactNode; title: string; wide?: boolean | undefined; children: ReactNode }) {
  return (
    <main className="kh-auth">
      <section className={wide ? "kh-auth-card kh-auth-card--wide" : "kh-auth-card"} aria-labelledby="kh-auth-title">
        {logo}
        <h1 id="kh-auth-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

/**
 * A value with a button that copies it, saying so for a moment. Where the
 * browser won't let the page write the clipboard, it selects the value instead,
 * ready for the visitor's own copy.
 */
function Copyable({ value, label }: { value: string; label: string }) {
  const i18n = useI18n();
  const [copied, setCopied] = useState(false);
  const text = useRef<HTMLElement>(null);
  const select = () => {
    const el = text.current;
    const selection = window.getSelection();
    if (!el || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (!navigator.clipboard) return select();
    navigator.clipboard.writeText(value).then(done, select);
    return undefined;
  };
  return (
    <dd>
      <code ref={text}>{value}</code>
      <button type="button" className="kh-auth-copy" onClick={copy}>
        <span aria-hidden="true">{i18n.t(copied ? "auth.demo.copied" : "auth.demo.copy")}</span>
        <span className="kh-sr-only">{copied ? i18n.t("auth.demo.copied") : label}</span>
      </button>
    </dd>
  );
}

function DemoAccounts({ accounts, onSignInAs, busy }: { accounts: readonly DemoAccount[]; onSignInAs: (username: string) => void; busy: boolean }) {
  const i18n = useI18n();
  return (
    <ul className="kh-auth-accounts">
      {accounts.map((a) => {
        const role = i18n.t(`shell.role.${a.role}`);
        return (
          <li key={a.username} className="kh-auth-account">
            <h2>{role}</h2>
            <p>{i18n.t(`auth.demo.roles.${a.role}`)}</p>
            <dl>
              <dt>{i18n.t("auth.demo.user")}</dt>
              <Copyable value={a.username} label={i18n.t("auth.demo.copyUser", { role })} />
              <dt>{i18n.t("auth.demo.password")}</dt>
              <Copyable value={a.password} label={i18n.t("auth.demo.copyPassword", { role })} />
            </dl>
            <button type="button" className="kh-auth-btn" onClick={() => onSignInAs(a.username)} disabled={busy}>
              {i18n.t("auth.demo.signInAs", { role })}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LoginScreen({
  site,
  logo,
  onSignIn,
  failed = false,
  busy = false,
  demoAccounts,
}: AuthScreenProps & { onSignIn: (username?: string) => void; failed?: boolean; busy?: boolean; demoAccounts?: readonly DemoAccount[] | undefined }) {
  const i18n = useI18n();
  const demo = demoAccounts && demoAccounts.length > 0;
  return (
    <Screen logo={logo} title={i18n.t("auth.title", { site })} wide={demo}>
      {demo ? (
        <>
          <p>{i18n.t("auth.demo.intro")}</p>
          <p className="kh-auth-shared">{i18n.t("auth.demo.shared")}</p>
          <p>{i18n.t("auth.demo.steps")}</p>
        </>
      ) : (
        <p>{i18n.t("auth.intro")}</p>
      )}
      {failed && (
        <p className="kh-auth-error" role="alert">
          {i18n.t("auth.failed")}
        </p>
      )}
      {demo && <DemoAccounts accounts={demoAccounts} onSignInAs={onSignIn} busy={busy} />}
      <button type="button" className={demo ? "kh-auth-btn kh-auth-btn--quiet" : "kh-auth-btn"} onClick={() => onSignIn()} disabled={busy}>
        {busy ? i18n.t("auth.loading") : i18n.t(demo ? "auth.demo.own" : "auth.signIn")}
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

export function AccessDenied({ logo, name, onSignOut, onSwitchUser }: Omit<AuthScreenProps, "site"> & { name: string; onSignOut: () => void; onSwitchUser?: () => void }) {
  const i18n = useI18n();
  return (
    <Screen logo={logo} title={i18n.t("auth.deniedTitle")}>
      <p>{i18n.t("auth.deniedBody", { name })}</p>
      {onSwitchUser && (
        <button type="button" className="kh-auth-btn" onClick={onSwitchUser}>
          {i18n.t("auth.otherUser")}
        </button>
      )}
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

export function AuthGate({
  auth,
  site,
  logo,
  demoAccounts,
  children,
}: AuthScreenProps & { auth: Auth; demoAccounts?: readonly DemoAccount[] | undefined; children: ReactNode }) {
  const state = useReadable(auth);
  // Remembered across renders: a later sign-out then reads as an expired session.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  if (state.status === "signedIn" && !wasSignedIn) setWasSignedIn(true);
  // Reaching the identity provider can fail before leaving the page (it is down, or unreachable).
  const [unreachable, setUnreachable] = useState(false);
  const view = gateView(state, wasSignedIn, auth.can("view"));
  const signIn = (username?: string) => {
    setUnreachable(false);
    auth.login(username).catch(() => setUnreachable(true));
  };
  // In a demo, an expired session goes back to the list of accounts, not to the provider's picker.
  const demo = Boolean(demoAccounts?.length);
  switch (view) {
    case "loading":
      return <LoginScreen site={site} logo={logo} onSignIn={signIn} busy demoAccounts={demoAccounts} />;
    case "login":
    case "loginFailed":
      return <LoginScreen site={site} logo={logo} onSignIn={signIn} failed={view === "loginFailed" || unreachable} demoAccounts={demoAccounts} />;
    case "expired":
      return demo ? (
        <LoginScreen site={site} logo={logo} onSignIn={signIn} failed={unreachable} demoAccounts={demoAccounts} />
      ) : (
        <SessionExpired logo={logo} onSignIn={() => signIn()} />
      );
    case "denied":
      return (
        <AccessDenied logo={logo} name={state.user?.name ?? ""} onSignOut={() => void auth.logout()} onSwitchUser={() => (demo ? void auth.logout() : signIn())} />
      );
    default:
      return <>{children}</>;
  }
}
