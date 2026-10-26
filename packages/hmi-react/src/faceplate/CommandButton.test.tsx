import { describe, expect, it } from "vitest";
import { render, spokenText } from "../test-render.tsx";
import { CommandButton } from "./CommandButton.tsx";

const noop = () => {};

describe("command button", () => {
  it("stays quiet when the command is allowed", () => {
    const html = render(<CommandButton label="Close…" interlock="permit" onCommand={noop} onExplain={noop} />);
    expect(html).toContain("kh-cmdbtn--permit");
    expect(html).not.toContain("kh-cmdbtn-lock");
    expect(spokenText(html)).toBe("Close…Why?");
  });

  it("says plainly when the command is interlocked, and links the note to the button", () => {
    const html = render(<CommandButton label="Close…" interlock="block" onCommand={noop} onExplain={noop} />);
    expect(html).toContain("kh-cmdbtn-lock");
    expect(spokenText(html)).toBe("Close…InterlockedWhy blocked?");
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy && html.includes(`id="${describedBy}"`)).toBe(true);
  });

  it("never reads as allowed while the state is unknown", () => {
    const html = render(<CommandButton label="Close…" interlock="unknown" onCommand={noop} onExplain={noop} />);
    expect(spokenText(html)).toContain("Interlock unknown");
  });

  it("offers no explanation for a command without an interlock", () => {
    const html = render(<CommandButton label="Open…" interlock="none" onCommand={noop} onExplain={noop} />);
    expect(spokenText(html)).toBe("Open…");
  });
});
