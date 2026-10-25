/**
 * The command dialog: select → confirm → progress → result, on top of the
 * core command service. Selecting checks permission and interlock and starts
 * a selection that expires; confirming re-checks and sends; the request's
 * steps are shown as they arrive. Bypass is offered only to users allowed to.
 */

import "./faceplate.css";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CommandKey, CommandResult, CommandSelection, RequestState, RequestUpdate } from "@khorde/hmi-core";
import { useHmi, useI18n } from "../context.tsx";

export interface CommandDialogProps {
  command: CommandKey;
  /** "Open F1 circuit breaker". */
  title: string;
  /** The verb for the confirm button: "open". */
  verb: string;
  /** Now → after, drawn by the caller (symbols). */
  preview?: ReactNode;
  effect?: ReactNode;
  /** For analogical commands: the value to send. */
  analog?: { min: number; max: number; unit?: string; step?: number; initial?: number };
  onClose: () => void;
  onDone?: (result: CommandResult) => void;
}

type Phase =
  | { kind: "selecting" }
  | { kind: "confirm"; selection: CommandSelection }
  | { kind: "running"; selection: CommandSelection; updates: readonly RequestUpdate[] }
  | { kind: "done"; result: CommandResult };

const STEPS: { states: RequestState[]; key: string }[] = [
  { states: ["FORWARDED_TO_AGENT", "FORWARDED_TO_AGENT_INTERLOCK_BYPASSED"], key: "forwarded" },
  { states: ["AGENT_RECEIVED"], key: "received" },
  { states: ["AGENT_SENT"], key: "sent" },
  { states: ["REQUEST_SUCCESS", "REQUEST_TIMEOUT", "REQUEST_ERROR"], key: "final" },
];
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

/** Whole seconds until `until`, counted from no earlier than `since`. */
function useSecondsLeft(until: Date | null, since: Date | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until.getTime() - Math.max(now, since?.getTime() ?? 0)) / 1000)) : 0;
}

export function CommandDialog({ command, title, verb, preview, effect, analog, onClose, onDone }: CommandDialogProps) {
  const i18n = useI18n();
  const { commands, auth } = useHmi();
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "selecting" });
  const [value, setValue] = useState(analog?.initial ?? analog?.min ?? 0);
  const [bypass, setBypass] = useState(false);
  const commandId = `${command.agent}|${command.equipment}|${command.name}`;

  useEffect(() => {
    if (!commands) return;
    let alive = true;
    const [agent, equipment, name] = commandId.split("|") as [string, string, string];
    void commands.select({ agent, equipment, name }).then((r) => {
      if (!alive) return;
      setPhase(r.ok ? { kind: "confirm", selection: r.selection } : { kind: "done", result: r.result });
    });
    return () => {
      alive = false;
    };
  }, [commands, commandId]);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const selected = phase.kind === "confirm" ? phase.selection : null;
  const secondsLeft = useSecondsLeft(selected?.expiresAt ?? null, selected?.selectedAt ?? null);
  const canBypass = auth?.can("bypassInterlock") ?? false;
  const valueOk = !analog || (Number.isFinite(value) && value >= analog.min && value <= analog.max);

  const confirm = async (selection: CommandSelection) => {
    if (!commands) return;
    const withValue = analog ? { ...selection, value } : selection;
    setPhase({ kind: "running", selection: withValue, updates: [] });
    const result = await commands.execute(withValue, {
      bypassInterlock: bypass,
      onUpdate: (updates) => setPhase((p) => (p.kind === "running" ? { ...p, updates } : p)),
    });
    setPhase({ kind: "done", result });
    onDone?.(result);
  };

  const eyebrow = i18n.t(phase.kind === "done" ? "commandDialog.eyebrowResult" : phase.kind === "running" ? "commandDialog.eyebrowProgress" : "commandDialog.eyebrowConfirm");
  const updates = phase.kind === "running" ? phase.updates : phase.kind === "done" ? phase.result.updates : [];

  return (
    <div className="kh-scrim">
      <section
        ref={box}
        className="kh-cmd"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && phase.kind !== "running" && onClose()}
      >
        <div className="kh-cmd-head">
          <span className="kh-fp-eyebrow">{eyebrow}</span>
          <h2 id={`${id}-title`}>{title}</h2>
          <span className="kh-fp-sub">
            {command.equipment} · {command.name} · {command.agent}
          </span>
        </div>

        {phase.kind === "selecting" && <p className="kh-cmd-note">{i18n.t("commandDialog.selecting")}</p>}

        {phase.kind === "confirm" && (
          <>
            {preview && <div className="kh-cmd-preview">{preview}</div>}
            <dl className="kh-cmd-facts">
              <dt>{i18n.t("commandDialog.interlock")}</dt>
              <dd>
                {!phase.selection.interlock.hasInterlock ? (
                  i18n.t("commandDialog.noInterlock")
                ) : phase.selection.interlock.outcome === "PERMIT" ? (
                  <strong>✓ {i18n.t("commandDialog.permitted")}</strong>
                ) : (
                  <strong className="kh-cmd-blocked">{i18n.t("commandDialog.blocked")}</strong>
                )}
              </dd>
              {effect && (
                <>
                  <dt>{i18n.t("commandDialog.effect")}</dt>
                  <dd>{effect}</dd>
                </>
              )}
            </dl>
            {analog && (
              <label className="kh-cmd-value">
                <span>{i18n.t("commandDialog.value")}</span>
                <input
                  type="number"
                  value={Number.isFinite(value) ? value : ""}
                  min={analog.min}
                  max={analog.max}
                  step={analog.step ?? 1}
                  aria-invalid={!valueOk}
                  aria-describedby={`${id}-range`}
                  onChange={(e) => setValue(e.target.valueAsNumber)}
                />
                {analog.unit && <span>{analog.unit}</span>}
                <span id={`${id}-range`} className={valueOk ? "kh-cmd-hint" : "kh-cmd-error"}>
                  {i18n.t(valueOk ? "commandDialog.valueRange" : "commandDialog.valueInvalid", { min: analog.min, max: analog.max })}
                </span>
              </label>
            )}
            {phase.selection.interlock.outcome === "BLOCK" && canBypass && (
              <label className="kh-cmd-bypass">
                <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
                <span>
                  <strong>{i18n.t("commandDialog.bypass")}</strong>
                  <span>{i18n.t("commandDialog.bypassWarn")}</span>
                </span>
              </label>
            )}
            <p className="kh-cmd-note">{secondsLeft > 0 ? i18n.t("commandDialog.expires", { seconds: secondsLeft }) : i18n.t("commandDialog.expired")}</p>
            <div className="kh-cmd-actions">
              <button type="button" className="kh-btn" onClick={onClose}>
                {i18n.t("commandDialog.cancel")}
              </button>
              <button
                type="button"
                className="kh-btn kh-btn--primary"
                disabled={secondsLeft === 0 || !valueOk || (phase.selection.interlock.outcome === "BLOCK" && !bypass)}
                onClick={() => void confirm(phase.selection)}
              >
                {i18n.t("commandDialog.confirm", { command: verb })}
              </button>
            </div>
          </>
        )}

        {(phase.kind === "running" || phase.kind === "done") && updates.length + (phase.kind === "running" ? 1 : 0) > 0 && (
          <ol className="kh-cmd-steps" aria-live="polite">
            {STEPS.map((step, i) => {
              const u = updates.find((x) => step.states.includes(x.state));
              const firstOpen = STEPS.findIndex((s) => !updates.some((x) => s.states.includes(x.state)));
              const current = phase.kind === "running" && !u && i === firstOpen;
              if (!u && !current) return null;
              const failed = u && (u.state === "REQUEST_TIMEOUT" || u.state === "REQUEST_ERROR");
              return (
                <li key={step.key} className={`kh-cmd-step${u ? " kh-cmd-step--done" : ""}${current ? " kh-cmd-step--current" : ""}${failed ? " kh-cmd-step--failed" : ""}`}>
                  <span className="kh-cmd-step-ico" aria-hidden="true" />
                  <span className="kh-cmd-step-text">
                    <span>{u ? i18n.t(`command.request.${u.state}`) : i18n.t("commandDialog.waiting")}</span>
                    {u?.msg && <span className="kh-cmd-hint">{u.msg}</span>}
                  </span>
                  <span className="kh-cmd-hint kh-num">{u ? i18n.formatDateTime(u.timestamp, TIME) : ""}</span>
                </li>
              );
            })}
          </ol>
        )}

        {phase.kind === "running" && <p className="kh-cmd-note">{i18n.t("commandDialog.closeNote")}</p>}

        {phase.kind === "done" && (
          <>
            <p className={`kh-cmd-result kh-cmd-result--${phase.result.status}`} role="status">
              {i18n.t(`command.status.${phase.result.status}`)}
              {phase.result.status === "denied" && <span className="kh-cmd-hint">{i18n.t("commandDialog.deniedNote")}</span>}
            </p>
            {phase.result.requestId && <span className="kh-fp-sub">{i18n.t("commandDialog.request", { id: phase.result.requestId })}</span>}
            <div className="kh-cmd-actions">
              <button type="button" className="kh-btn kh-btn--primary" onClick={onClose} autoFocus>
                {i18n.t("commandDialog.close")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
