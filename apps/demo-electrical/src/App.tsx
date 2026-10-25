import { AppShell, AuthGate, Footer, Header, HmiProvider, roleKey, useI18n, useReadable } from "@khorde/hmi-react";
import { SCENARIOS, type Scenario } from "@khorde/demo-plant/sim";
import { Suspense, use, useEffect, useState } from "react";
import { startOnce, type Booted } from "./boot.ts";
import { InterlockWorkbench, type BenchCommand } from "./InterlockWorkbench.tsx";
import { DEV_PAGES, PAGES, parseRoute, routeHash, type PageId, type Route } from "./navigation.ts";
import { plant } from "./plant.ts";
import { AlarmsScreen } from "./screens/AlarmsScreen.tsx";
import { CommsScreen } from "./screens/CommsScreen.tsx";
import { EventsScreen } from "./screens/EventsScreen.tsx";
import { OverviewScreen } from "./screens/OverviewScreen.tsx";
import { SubstationScreen } from "./screens/SubstationScreen.tsx";
import { TrendsScreen } from "./screens/TrendsScreen.tsx";
import { WindFarmScreen } from "./screens/WindFarmScreen.tsx";
import { SymbolSheet } from "./SymbolSheet.tsx";

const BENCH: BenchCommand[] = [
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.bc.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.es", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.tr1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.hv.l1.ds", name: "pos.open" }, verb: "Open" },
  { key: { agent: plant.agents.windfarm, equipment: "vds.wf.f1.t01", name: "start" }, verb: "Start" },
];

const SUBTITLE = `${(plant.turbines.length * 4.5).toFixed(0)} MW · ${plant.turbines.length} WTG · 34.5/138 kV`;
const LOGO = <span className="logo-mark" aria-hidden="true" />;

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (r) => (window.location.hash = routeHash(r))];
}

function crumbs(route: Route, equipmentName: (id: string) => string) {
  const page = [...PAGES, ...DEV_PAGES].find((p) => p.id === route.page);
  const list = [{ label: "Ventos da Serra", href: "#overview" }, { label: page?.label ?? "" }];
  return route.focus ? [...list.slice(0, 1), { label: page?.label ?? "", href: `#${route.page}` }, { label: equipmentName(route.focus) }] : list;
}

function Frame({ booted }: { booted: Booted }) {
  const { hmi, site } = booted;
  const i18n = useI18n();
  const [route, go] = useRoute();
  const beats = useReadable(hmi.agents ?? { get: () => new Map(), subscribe: () => () => {} });
  const session = useReadable(hmi.auth);
  const theme = useReadable(hmi.theme);
  const [scenario, setScenario] = useState<Scenario>("showcase");
  const navigate = (page: PageId, focus?: string) => go({ page, focus: focus ?? null });
  const focus = (id: string | null) => go({ page: route.page, focus: id });

  const screen = (() => {
    switch (route.page) {
      case "substation":
        return <SubstationScreen focus={route.focus} onFocus={focus} />;
      case "windfarm":
        return <WindFarmScreen focus={route.focus} onFocus={focus} />;
      case "alarms":
        return <AlarmsScreen onNavigate={navigate} />;
      case "events":
        return <EventsScreen />;
      case "trends":
        return <TrendsScreen />;
      case "comms":
        return <CommsScreen agents={hmi.agents} onOpenTurbine={(id) => navigate("windfarm", id)} />;
      case "interlocks":
        return <InterlockWorkbench commands={BENCH} backend={site?.backend ?? null} />;
      case "symbols":
        return <SymbolSheet />;
      default:
        return <OverviewScreen onNavigate={navigate} />;
    }
  })();

  return (
    <AppShell
      header={
        <Header
          site={{ name: hmi.config.siteName, subtitle: SUBTITLE, logo: LOGO }}
          nav={PAGES.map((p) => ({ id: p.id, label: p.label, href: `#${p.id}` }))}
          active={route.page}
          onNavigate={(id) => navigate(id as PageId)}
          breadcrumb={crumbs(route, (id) => i18n.equipmentName(id))}
          user={session.user ? { name: session.user.name, role: i18n.t(roleKey(session.roles)) } : null}
          onSwitchUser={() => void hmi.auth.login()}
          onSignOut={() => void hmi.auth.logout()}
          {...(hmi.auth.can("ackAlarm") ? { onAck: (a: { instanceId: string }) => void hmi.alarms.ack(a.instanceId) } : {})}
          onOpenAlarms={() => navigate("alarms")}
        />
      }
      footer={
        <Footer agents={beats}>
          {site && (
            <label className="footer-theme">
              Scenario
              <select
                value={scenario}
                onChange={(e) => {
                  const s = e.target.value as Scenario;
                  setScenario(s);
                  site.scenario(s);
                }}
              >
                {SCENARIOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="footer-theme">
            Theme
            <select value={theme} onChange={(e) => hmi.theme.set(e.target.value)}>
              {hmi.theme.list().map((t) => (
                <option key={t.id} value={t.id}>
                  {i18n.t(t.nameKey)}
                </option>
              ))}
            </select>
          </label>
          {DEV_PAGES.map((p) => (
            <a key={p.id} className="footer-link" href={`#${p.id}`}>
              {p.label}
            </a>
          ))}
          <span>{site ? "In-browser simulator" : hmi.config.api.http} · Khorde HMI demo v0.1</span>
        </Footer>
      }
    >
      {screen}
    </AppShell>
  );
}

/** Waits for the live services (registry, alarms, heartbeats) before showing the screens. */
function Started({ booted }: { booted: Booted }) {
  use(startOnce(booted.hmi));
  return <Frame booted={booted} />;
}

function Starting() {
  const i18n = useI18n();
  return (
    <div className="boot-screen" role="status">
      {i18n.t("connection.connecting")}…
    </div>
  );
}

export function App({ booted }: { booted: Booted }) {
  const { hmi } = booted;
  return (
    <HmiProvider hmi={hmi}>
      <AuthGate auth={hmi.auth} site={hmi.config.siteName} logo={LOGO}>
        <Suspense fallback={<Starting />}>
          <Started booted={booted} />
        </Suspense>
      </AuthGate>
    </HmiProvider>
  );
}

