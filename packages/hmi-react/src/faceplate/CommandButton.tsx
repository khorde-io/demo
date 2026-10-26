import "./faceplate.css";
import type { CommandInterlockState } from "@khorde/hmi-core";
import { useId } from "react";
import { useI18n } from "../context.tsx";

export interface CommandButtonProps {
  /** "Close…". */
  label: string;
  /** From `useInterlockStates`. */
  interlock: CommandInterlockState;
  onCommand: () => void;
  /** Shows the command's interlock; omitted when there is none. */
  onExplain?: () => void;
  /** This command's interlock is the one shown. */
  explained?: boolean;
  disabled?: boolean;
}

function Padlock() {
  return (
    <svg className="kh-cmdbtn-lock" width={12} height={14} viewBox="0 0 12 14" aria-hidden="true">
      <rect x={0.75} y={6} width={10.5} height={7.25} rx={1.5} />
      <path d="M3 6 V4.2 a3 3 0 0 1 6 0 V6" />
    </svg>
  );
}

/**
 * A command button that tells its interlock state without opening anything,
 * quietly when the command is allowed and plainly when it is not:
 *
 * - allowed (or no interlock): a plain button, with a small "Why?" link;
 * - interlocked: violet frame and padlock, "Interlocked", and "Why blocked?";
 * - unknown (not loaded, or an input is stale): a "?" and "Interlock unknown".
 *
 * An interlocked command stays clickable: the dialog says why it is refused
 * and offers the bypass to users allowed to use it.
 */
export function CommandButton({ label, interlock, onCommand, onExplain, explained = false, disabled = false }: CommandButtonProps) {
  const i18n = useI18n();
  const noteId = useId();
  const note = interlock === "block" ? i18n.t("commandButton.interlocked") : interlock === "unknown" ? i18n.t("commandButton.unknown") : null;
  return (
    <span className={`kh-cmdbtn kh-cmdbtn--${interlock}`}>
      <button
        type="button"
        className="kh-btn kh-btn--sm kh-cmdbtn-btn"
        disabled={disabled}
        onClick={onCommand}
        {...(note ? { "aria-describedby": noteId } : {})}
      >
        {interlock === "block" && <Padlock />}
        {interlock === "unknown" && (
          <span className="kh-cmdbtn-unknown" aria-hidden="true">
            ?
          </span>
        )}
        {label}
      </button>
      {note && (
        <span id={noteId} className="kh-cmdbtn-note">
          {note}
        </span>
      )}
      {onExplain && interlock !== "none" && (
        <button type="button" className="kh-link kh-cmdbtn-why" aria-pressed={explained} onClick={onExplain}>
          {interlock === "block" ? i18n.t("commandButton.whyBlocked") : i18n.t("commandButton.why")}
        </button>
      )}
    </span>
  );
}
