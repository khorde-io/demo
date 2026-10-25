/** Rendering helpers for the component tests. Not exported from the package. */

import { coreMessages, createI18n } from "@khorde/hmi-core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HmiProvider, type HmiServices } from "./context.tsx";
import { reactMessages } from "./messages.ts";

export const testI18n = createI18n({
  locale: "en",
  catalogs: {
    en: [
      { messages: coreMessages },
      { messages: reactMessages },
      {
        messages: { alarms: { wf_f3_t14_state: { fault: "WTG 14 converter fault" } } },
        equipment: { "vds.wf.f3": "Wind farm · F3" },
      },
    ],
  },
});

export function render(node: ReactNode, services: Partial<HmiServices> = {}): string {
  return renderToStaticMarkup(<HmiProvider hmi={{ i18n: testI18n, ...services }}>{node}</HmiProvider>);
}

/** Renders inside an <svg>, for symbols. */
export const renderSvg = (node: ReactNode, services: Partial<HmiServices> = {}) => render(<svg>{node}</svg>, services);

export const count = (html: string, s: string) => html.split(s).length - 1;
