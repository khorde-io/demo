/**
 * The faceplate frame: a side panel (or a modal) with a title and tabs
 * (Overview, Control, Alarms, Trend, Info by convention). What each tab shows
 * is the project's; the frame handles focus, Escape and tab keys.
 */

import "./faceplate.css";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../context.tsx";

export interface FaceplateTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface FaceplateProps {
  eyebrow?: string;
  title: string;
  /** Usually the equipment id. */
  subtitle?: string;
  tabs: readonly FaceplateTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onClose: () => void;
  variant?: "side" | "modal";
}

export function Faceplate({ eyebrow, title, subtitle, tabs, activeTab, onTabChange, onClose, variant = "side" }: FaceplateProps) {
  const i18n = useI18n();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  const onTabKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active?.id);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    if (next) {
      onTabChange(next.id);
      document.getElementById(`${id}-tab-${next.id}`)?.focus();
    }
  };

  const body = (
    <div
      ref={panel}
      className={`kh-faceplate kh-faceplate--${variant}`}
      role="dialog"
      aria-modal={variant === "modal"}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="kh-fp-head">
        <div className="kh-fp-titles">
          {eyebrow && <span className="kh-fp-eyebrow">{eyebrow}</span>}
          <h2 id={`${id}-title`}>{title}</h2>
          {subtitle && <span className="kh-fp-sub">{subtitle}</span>}
        </div>
        <button type="button" className="kh-fp-close" aria-label={i18n.t("faceplate.close")} onClick={onClose}>
          <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 3 L15 15 M15 3 L3 15" />
          </svg>
        </button>
      </div>
      <div className="kh-fp-tabs" role="tablist" aria-label={i18n.t("faceplate.tabs")} onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${id}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === active?.id}
            aria-controls={`${id}-panel`}
            tabIndex={t.id === active?.id ? 0 : -1}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="kh-fp-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={active ? `${id}-tab-${active.id}` : undefined}>
        {active?.content}
      </div>
    </div>
  );

  return variant === "modal" ? (
    <div className="kh-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {body}
    </div>
  ) : (
    body
  );
}
