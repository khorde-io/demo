import {
  SCADA_ROLES,
  coreMessages,
  createAlarmStore,
  createCommandService,
  createHeartbeatMonitor,
  createHistoryService,
  createI18n,
  createPointStore,
} from "@khorde/hmi-core";
import { createMockBackend, createStaticAuth } from "@khorde/hmi-core/mock";
import { AppShell, AuthGate, Footer, Header, HmiProvider, reactMessages, roleKey, useI18n, useReadable } from "@khorde/hmi-react";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@khorde/hmi-theme";
import { buildPlant } from "@khorde/demo-plant";
import { useEffect, useState } from "react";
import { projectCatalog } from "./dictionary.ts";
import { InterlockWorkbench, type BenchCommand } from "./InterlockWorkbench.tsx";
import { startLiveValues } from "./liveValues.ts";
import { mockPlant } from "./mockPlant.ts";
import { AlarmsPage } from "./pages/AlarmsPage.tsx";
import { FeederPage } from "./pages/FeederPage.tsx";
import { TrendsPage } from "./pages/TrendsPage.tsx";
import { SymbolSheet } from "./SymbolSheet.tsx";

// Development screens on the mock backend until the plant screens land
// (phase 6), inside the real shell and behind the real sign-in gate.
const THEME_NAMES: Record<ThemeId, string> = {
  "dark-grey": "Dark grey",
  "range-green": "Range Green",
  ink: "Ink",
};

const plant = buildPlant();
const backend = createMockBackend(mockPlant(plant));
const auth = createStaticAuth({ name: "operator1", roles: [SCADA_ROLES.viewer, SCADA_ROLES.operator, SCADA_ROLES.alarmAck] });
const alarms = createAlarmStore(backend, { permissions: auth });
const agents = createHeartbeatMonitor(backend, "agent", Object.values(plant.agents));
const services = {
  i18n: createI18n({
    locale: "en",
    catalogs: {
      en: [
        { messages: coreMessages },
        { messages: reactMessages },
        {
          ...projectCatalog(plant),
          messages: {
            alarms: {
              wf_f3_t14_state: { fault: "WTG 14 converter fault trip" },
              sub_tr2_oil_temp: { high: "TR2 oil temperature high" },
              sub_mv_a_f2_cb_sf6_low: { _: "F2 breaker SF6 pressure low" },
            },
          },
        },
      ],
    },
  }),
  backend,
  auth,
  points: createPointStore(backend),
  alarms,
  commands: createCommandService(backend, { permissions: auth }),
  history: createHistoryService(backend),
};

// The showcase alarms, so the header and the list have something to show.
backend.raiseAlarm({ name: "sub_mv_a_f2_cb_sf6_low", area: "vds.sub.mv.a.f2", severity: "low" });
backend.raiseAlarm({ name: "sub_tr2_oil_temp", area: "vds.sub.tr2", condition: "high", severity: "medium", value: 78 });
backend.raiseAlarm({ name: "wf_f3_t14_state", area: "vds.wf.f3", condition: "fault", severity: "high", value: 3 });
void alarms.start();
void agents.start();
startLiveValues(backend);

const BENCH: BenchCommand[] = [
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.bc.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.es", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.tr1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.hv.l1.ds", name: "pos.open" }, verb: "Open" },
  { key: { agent: plant.agents.windfarm, equipment: "vds.wf.f1.t01", name: "start" }, verb: "Start" },
];

const NAV = [
  { id: "feeder", label: "Faceplate" },
  { id: "alarms", label: "Alarms" },
  { id: "trends", label: "Trends" },
  { id: "interlocks", label: "Interlocks" },
  { id: "symbols", label: "Symbols" },
];

function useHashPage(fallback: string): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#/, "") || fallback;
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  });
  return [page, (id) => (window.location.hash = id)];
}

const LOGO = <span className="logo-mark" aria-hidden="true" />;

function Frame() {
  const i18n = useI18n();
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [page, go] = useHashPage("feeder");
  const beats = useReadable(agents);
  const session = useReadable(auth);
  const current = NAV.find((n) => n.id === page) ?? NAV[0]!;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <AppShell
      header={
        <Header
          site={{ name: "Ventos da Serra", subtitle: "108 MW · 24 WTG · 34.5/138 kV", logo: LOGO }}
          nav={NAV}
          active={current.id}
          onNavigate={go}
          breadcrumb={[{ label: "Development" }, { label: current.label }]}
          user={session.user ? { name: session.user.name, role: i18n.t(roleKey(session.roles)) } : null}
          {...(auth.can("ackAlarm") ? { onAck: (a: { instanceId: string }) => void alarms.ack(a.instanceId) } : {})}
          onOpenAlarms={() => go("alarms")}
        />
      }
      footer={
        <Footer agents={beats}>
          <label className="footer-theme">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {THEME_NAMES[t.id]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="footer-link" onClick={() => void auth.logout()}>
            Sign out
          </button>
          <span>Mock backend · Khorde HMI demo v0.1</span>
        </Footer>
      }
    >
      {current.id === "symbols" ? (
        <SymbolSheet />
      ) : current.id === "interlocks" ? (
        <InterlockWorkbench commands={BENCH} backend={backend} />
      ) : current.id === "alarms" ? (
        <AlarmsPage />
      ) : current.id === "trends" ? (
        <TrendsPage />
      ) : (
        <FeederPage />
      )}
    </AppShell>
  );
}

export function App() {
  return (
    <HmiProvider hmi={services}>
      <AuthGate auth={auth} site="Ventos da Serra" logo={LOGO}>
        <Frame />
      </AuthGate>
    </HmiProvider>
  );
}
