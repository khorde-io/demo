// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "../test-dom.tsx";
import { Header } from "./shell.tsx";

const user = { name: "Ana Operator", role: "Operator" };

describe("account menu", () => {
  it("offers another user and sign-out from the user chip", async () => {
    const onSwitchUser = vi.fn();
    const onSignOut = vi.fn();
    const m = await mount(<Header site={{ name: "VDS" }} nav={[]} user={user} onSwitchUser={onSwitchUser} onSignOut={onSignOut} now={new Date(0)} />);
    expect(m.container.querySelector('[role="menu"]')).toBeNull();
    await m.click(m.button("Ana Operator"));
    await m.click(m.button("Sign in as another user"));
    expect(onSwitchUser).toHaveBeenCalledOnce();
    expect(m.container.querySelector('[role="menu"]')).toBeNull();
    await m.click(m.button("Ana Operator"));
    await m.click(m.button("Sign out"));
    expect(onSignOut).toHaveBeenCalledOnce();
    m.unmount();
  });

  it("is a plain chip without account actions", async () => {
    const m = await mount(<Header site={{ name: "VDS" }} nav={[]} user={user} now={new Date(0)} />);
    expect(m.container.querySelector(".kh-user--button")).toBeNull();
    m.unmount();
  });
});
