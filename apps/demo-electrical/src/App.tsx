import { coreMessages, createI18n, createPointStore } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { HmiProvider } from "@khorde/hmi-react";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@khorde/hmi-theme";
import { buildPlant } from "@khorde/demo-plant";
import { useEffect, useState } from "react";
import { projectCatalog } from "./dictionary.ts";
import { InterlockWorkbench, type BenchCommand } from "./InterlockWorkbench.tsx";
import { mockPlant } from "./mockPlant.ts";

// Temporary screen until the shell and the plant screens land: the interlock
// view against the demo plant on the mock backend.
const THEME_NAMES: Record<ThemeId, string> = {
  "dark-grey": "Dark grey",
  "range-green": "Range Green",
  ink: "Ink",
};

const plant = buildPlant();
const backend = createMockBackend(mockPlant(plant));
const services = {
  i18n: createI18n({ locale: "en", catalogs: { en: [{ messages: coreMessages }, projectCatalog(plant)] } }),
  backend,
  points: createPointStore(backend),
};

const BENCH: BenchCommand[] = [
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.bc.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.es", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.f1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.mv.a.tr1.cb", name: "pos.close" }, verb: "Close" },
  { key: { agent: plant.agents.substation, equipment: "vds.sub.hv.l1.ds", name: "pos.open" }, verb: "Open" },
  { key: { agent: plant.agents.windfarm, equipment: "vds.wf.f1.t01", name: "start" }, verb: "Start" },
];

export function App() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <HmiProvider hmi={services}>
      <main className="scaffold">
        <header className="scaffold-header">
          <span className="scaffold-title">Ventos da Serra · Interlock view</span>
          <label className="scaffold-picker">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {THEME_NAMES[t.id]}
                </option>
              ))}
            </select>
          </label>
        </header>
        <InterlockWorkbench commands={BENCH} backend={backend} />
      </main>
    </HmiProvider>
  );
}
