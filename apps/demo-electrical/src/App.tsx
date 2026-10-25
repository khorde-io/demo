import { DEFAULT_THEME, THEME_TOKENS, THEMES, type ThemeId } from "@khorde/hmi-theme";
import { useEffect, useState } from "react";

// Temporary scaffold screen: proves the workspace, the theme package and theme
// switching work end to end. Replaced by the real shell in phase 4.
const THEME_NAMES: Record<ThemeId, string> = {
  "dark-grey": "Dark grey",
  "range-green": "Range Green",
  ink: "Ink",
};

export function App() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main className="scaffold">
      <header className="scaffold-header">
        <span className="scaffold-title">Ventos da Serra · Khorde HMI scaffold</span>
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
      <ul className="scaffold-tokens">
        {THEME_TOKENS.map((token) => (
          <li key={token}>
            <span className="scaffold-swatch" style={{ background: `var(--${token})` }} aria-hidden="true" />
            <code>--{token}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
