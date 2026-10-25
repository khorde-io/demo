/**
 * The application frame: header (site, navigation, alarm summary, clock,
 * user), the latest-alarm strip with the breadcrumb, the view area, and the
 * footer (connection and agent health). Everything a project changes is a
 * prop: menu items, site name, the canvas size of its displays.
 */

import "./shell.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCADA_ROLES, type Alarm, type AlarmPriority, type ConnectionState, type Heartbeat } from "@khorde/hmi-core";
import { useAlarms, useConnection, useI18n } from "../context.tsx";
import { AlarmShape } from "../symbols/parts.tsx";
import { alarmIndication, AlarmIndicator, StatusDot, type Connectivity } from "../widgets/widgets.tsx";

// ── AppShell ──────────────────────────────────────────────────────────────

export interface AppShellProps {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /**
   * Fixed design size of the display (1920 × 1080 for the demo). The whole
   * frame is drawn at that size and scaled to fit the window. Omit it to let
   * the frame follow the window.
   */
  canvas?: { width: number; height: number };
  /** The page's name, as its (visually hidden) top heading. */
  title?: string;
}

export function AppShell({ header, footer, children, canvas, title }: AppShellProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = stage.current;
    if (!canvas || !el || typeof ResizeObserver === "undefined") return;
    const fit = () => setScale(Math.min(el.clientWidth / canvas.width, el.clientHeight / canvas.height));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [canvas]);

  const frame = (
    <div className="kh-shell" style={canvas ? { width: canvas.width, height: canvas.height, transform: `scale(${scale})` } : undefined}>
      {header}
      {/* Focusable so a keyboard can scroll it even on a page with no controls. */}
      <main className="kh-shell-main" tabIndex={0} aria-label={title}>
        {title && <h1 className="kh-sr-only">{title}</h1>}
        {children}
      </main>
      {footer}
    </div>
  );
  return canvas ? (
    <div className="kh-shell-stage" ref={stage}>
      {frame}
    </div>
  ) : (
    frame
  );
}

// ── Header ────────────────────────────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  href?: string;
}

export interface Crumb {
  label: string;
  href?: string;
}

export interface HeaderProps {
  site: { name: string; subtitle?: string; logo?: ReactNode };
  nav: readonly NavItem[];
  active?: string;
  /** Called on a nav click; without it the items are plain links. */
  onNavigate?: (id: string) => void;
  breadcrumb?: readonly Crumb[];
  user?: { name: string; role: string } | null;
  /** With either, the user chip opens an account menu. */
  onSwitchUser?: () => void;
  onSignOut?: () => void;
  /** IANA zone for the clock; defaults to the browser's. */
  timeZone?: string;
  /** Fixed time, for tests and screenshots. */
  now?: Date;
  /** Opens the alarm list (from the summary and the banner). */
  onOpenAlarms?: () => void;
  /** Acknowledges the banner's alarm; omit it when the user may not acknowledge. */
  onAck?: (alarm: Alarm) => void;
}

function useNow(fixed: Date | undefined, everyMs = 1000): Date {
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) return;
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [fixed, everyMs]);
  return fixed ?? now;
}

function zoneName(locale: string, at: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: "shortOffset", ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "Ana Lima" → "AL"; a single word gives its first two letters ("operator1" → "OP"). */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** The alarm to show in the banner: the newest unacknowledged one (the most urgent on a tie), else the newest. */
export function bannerAlarm(alarms: readonly Alarm[]): Alarm | null {
  const pick = (list: readonly Alarm[]) =>
    list.reduce<Alarm | null>((best, a) => {
      if (!best) return a;
      const dt = a.timestamp.getTime() - best.timestamp.getTime();
      return dt > 0 || (dt === 0 && a.priority < best.priority) ? a : best;
    }, null);
  return pick(alarms.filter((a) => !a.acked)) ?? pick(alarms);
}

function UserChip({ name, role }: { name: string; role: string }) {
  return (
    <>
      <span className="kh-user-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="kh-user-text">
        <span className="kh-user-name">{name}</span> <span className="kh-user-role">{role}</span>
      </span>
    </>
  );
}

/** The user chip as a menu button: sign in as someone else, or sign out. */
function UserMenu({ user, onSwitchUser, onSignOut }: { user: { name: string; role: string }; onSwitchUser?: (() => void) | undefined; onSignOut?: (() => void) | undefined }) {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div
      ref={box}
      className="kh-user-menu"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="kh-user kh-user--button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <UserChip name={user.name} role={user.role} />
      </button>
      {open && (
        <div className="kh-user-pop" role="menu">
          {onSwitchUser && (
            <button type="button" role="menuitem" autoFocus onClick={pick(onSwitchUser)}>
              {i18n.t("shell.switchUser")}
            </button>
          )}
          {onSignOut && (
            <button type="button" role="menuitem" autoFocus={!onSwitchUser} onClick={pick(onSignOut)}>
              {i18n.t("shell.signOut")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ site, nav, active, onNavigate, breadcrumb = [], user, onSwitchUser, onSignOut, timeZone, now: fixedNow, onOpenAlarms, onAck }: HeaderProps) {
  const i18n = useI18n();
  const { alarms, counts } = useAlarms();
  const now = useNow(fixedNow);
  const locale = i18n.locale.get();
  const latest = bannerAlarm(alarms);
  const tz = timeZone ? { timeZone } : {};

  return (
    <header className="kh-header">
      <div className="kh-header-main">
        <div className="kh-site">
          {site.logo}
          <div className="kh-site-text">
            <span className="kh-site-name">{site.name}</span>
            {site.subtitle && <span className="kh-site-sub">{site.subtitle}</span>}
          </div>
        </div>

        <nav className="kh-nav" aria-label={i18n.t("shell.mainNav")}>
          {nav.map((item) => {
            const current = item.id === active;
            const props = { className: `kh-nav-item${current ? " kh-nav-item--active" : ""}`, ...(current ? { "aria-current": "page" as const } : {}) };
            return onNavigate ? (
              <button key={item.id} type="button" {...props} onClick={() => onNavigate(item.id)}>
                {item.label}
              </button>
            ) : (
              <a key={item.id} href={item.href ?? `#${item.id}`} {...props}>
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="kh-summary" role="group" aria-label={i18n.t("shell.alarmSummary")}>
          {([1, 2, 3] as AlarmPriority[]).map((p) => {
            const c = counts.byPriority[p];
            return (
              <button key={p} type="button" className="kh-summary-item" onClick={onOpenAlarms}>
                <span className="kh-sr-only">{i18n.t("shell.priorityLabel", { priority: p })} </span>
                <svg width={20} height={20} viewBox="-1 -1 22 22" aria-hidden="true">
                  <AlarmShape priority={p} indication={c.unacked > 0 ? "active-unacked" : "active-acked"} />
                </svg>
                <span className="kh-summary-count">{c.total}</span>
                <span className="kh-sr-only"> {i18n.t("shell.prioritySuffix", { unacked: c.unacked })}</span>
              </button>
            );
          })}
          <span className="kh-summary-unacked">{i18n.t("shell.unacked", { count: counts.unacked })}</span>
        </div>

        <div className="kh-header-end">
          <div className="kh-clock">
            <span className="kh-clock-time">{i18n.formatDateTime(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", ...tz })}</span>
            <span className="kh-clock-date">
              {i18n.formatDateTime(now, { day: "numeric", month: "short", year: "numeric", ...tz })} · {zoneName(locale, now, timeZone)}
            </span>
          </div>
          {user &&
            (onSwitchUser || onSignOut ? (
              <UserMenu user={user} onSwitchUser={onSwitchUser} onSignOut={onSignOut} />
            ) : (
              <div className="kh-user">
                <span className="kh-sr-only">{i18n.t("shell.signedInAsPrefix")} </span>
                <UserChip name={user.name} role={user.role} />
              </div>
            ))}
        </div>
      </div>

      <div className="kh-header-strip">
        <nav className="kh-crumbs" aria-label={i18n.t("shell.breadcrumb")}>
          {breadcrumb.map((c, i) => (
            <span key={`${i}-${c.label}`} className="kh-crumb">
              {i > 0 && (
                <span className="kh-crumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {c.href && i < breadcrumb.length - 1 ? <a href={c.href}>{c.label}</a> : <span {...(i === breadcrumb.length - 1 ? { "aria-current": "page" as const } : {})}>{c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="kh-banner" aria-live="polite" aria-label={i18n.t("shell.latestAlarm")}>
          {latest ? (
            <>
              <AlarmIndicator priority={latest.priority} indication={alarmIndication(latest)} size={18} />
              <span className="kh-banner-time">{i18n.formatDateTime(latest.timestamp, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", ...tz })}</span>
              <span className="kh-banner-text">{i18n.alarmText(latest)}</span>
              <span className="kh-banner-area">{i18n.equipmentName(latest.area)}</span>
              {!latest.acked && <span className={`kh-banner-pill kh-banner-pill--p${latest.priority}`}>{i18n.t("alarm.unacked")}</span>}
            </>
          ) : (
            <span className="kh-banner-none">{i18n.t("shell.noAlarms")}</span>
          )}
        </div>
        <div className="kh-banner-actions">
          {latest && !latest.acked && onAck && (
            <button type="button" className="kh-strip-btn" onClick={() => onAck(latest)}>
              {i18n.t("shell.ack")}
            </button>
          )}
          {onOpenAlarms && (
            <button type="button" className="kh-strip-link" onClick={onOpenAlarms}>
              {i18n.t("shell.alarmList")}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** Dictionary key of the role to show for a user: the most capable one they hold. */
export function roleKey(roles: ReadonlySet<string>): string {
  if (roles.has(SCADA_ROLES.operator) && roles.has(SCADA_ROLES.interlockBypass)) return "shell.role.supervisor";
  if (roles.has(SCADA_ROLES.operator)) return "shell.role.operator";
  if (roles.has(SCADA_ROLES.viewer)) return "shell.role.viewer";
  return "shell.role.none";
}

// ── Footer ────────────────────────────────────────────────────────────────

const CONNECTIVITY: Record<ConnectionState, Connectivity> = { online: "online", offline: "offline", connecting: "unknown", idle: "unknown" };

export interface FooterProps {
  /** Agent heartbeats (from `hmi.agents`). */
  agents?: ReadonlyMap<string, Heartbeat>;
  /** Site/leaf heartbeats (from `hmi.sites`). */
  sites?: ReadonlyMap<string, Heartbeat>;
  /** Extra items on the right: theme, language, version. */
  children?: ReactNode;
}

function worst(beats: readonly Heartbeat[]): Connectivity {
  if (beats.some((b) => b.status === "offline")) return "offline";
  if (beats.some((b) => b.status === "unknown")) return "unknown";
  return "online";
}

export function Footer({ agents, sites, children }: FooterProps) {
  const i18n = useI18n();
  const connection = useConnection();
  const agentList = agents ? [...agents.values()] : [];
  const siteList = sites ? [...sites.values()] : [];
  return (
    <footer className="kh-footer">
      <span className="kh-footer-item">
        <StatusDot status={CONNECTIVITY[connection]} />
        {i18n.t("shell.api", { state: i18n.t(`connection.${connection}`) })}
      </span>
      {agentList.length > 0 && (
        <span className="kh-footer-item">
          <StatusDot status={worst(agentList)} />
          {i18n.t("shell.agents", { online: agentList.filter((a) => a.status === "online").length, total: agentList.length })}
        </span>
      )}
      {siteList.length > 0 && (
        <span className="kh-footer-item">
          <StatusDot status={worst(siteList)} />
          {i18n.t("shell.sites", { state: i18n.t(`heartbeat.${worst(siteList)}`) })}
        </span>
      )}
      <span className="kh-footer-spacer" />
      {children}
    </footer>
  );
}
