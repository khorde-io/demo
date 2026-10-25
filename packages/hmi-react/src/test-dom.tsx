/**
 * Mounting components in a DOM for tests that click and wait (files that
 * start with `// @vitest-environment happy-dom`). Not exported from the package.
 */

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HmiProvider, type HmiServices } from "./context.tsx";
import { testI18n } from "./test-render.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  /** The button whose text includes `text`. */
  button(text: string): HTMLButtonElement;
  click(el: Element): Promise<void>;
  /** Lets pending promises and timers settle. */
  settle(ms?: number): Promise<void>;
  unmount(): void;
}

export async function mount(node: ReactNode, services: Partial<HmiServices> = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<HmiProvider hmi={{ i18n: testI18n, ...services }}>{node}</HmiProvider>));
  const settle = async (ms = 0) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };
  return {
    container,
    button(text) {
      const b = [...container.querySelectorAll("button")].find((x) => x.textContent?.includes(text));
      if (!b) throw new Error(`No button "${text}" in: ${container.textContent}`);
      return b;
    },
    async click(el) {
      await act(async () => {
        (el as HTMLElement).click();
      });
    },
    settle,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}
