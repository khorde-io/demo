import { AlarmIndicator, AlarmList, alarmIndication, useAlarms, useHmi, useI18n } from "@khorde/hmi-react";
import { useState } from "react";
import { focusOf, type PageId } from "../navigation.ts";

const AREAS = [
  { label: "Substation", patterns: ["vds.sub.>"] },
  { label: "Wind farm", patterns: ["vds.wf.>"] },
];

/** The equipment an alarm is about: its measurement's equipment, from the alarm name. */
function equipmentOf(name: string, area: string): string | null {
  // Names are `<equipment with underscores>_<point>`; try the longest equipment id first.
  const parts = name.split("_");
  for (let n = parts.length - 1; n > 0; n--) {
    const id = `vds.${parts.slice(0, n).join(".")}`;
    if (focusOf(id)) return id;
  }
  return focusOf(area) ? area : null;
}

/** L4: the live list with a detail panel. Ack here; the history is the event log. */
export function AlarmsScreen({ onNavigate }: { onNavigate: (page: PageId, focus?: string) => void }) {
  const i18n = useI18n();
  const { alarms: store, auth } = useHmi();
  const { alarms } = useAlarms();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = alarms.find((a) => a.instanceId === selectedId) ?? null;
  const equipment = selected ? equipmentOf(selected.name, selected.area) : null;

  return (
    <div className="page page--alarms">
      <section className="page-panel">
        <AlarmList areas={AREAS} selectedId={selectedId} onSelect={(a) => setSelectedId(a.instanceId)} />
      </section>
      <aside className="page-panel" aria-label="Selected alarm">
        {selected ? (
          <>
            <span className="eyebrow">Selected alarm</span>
            <div className="detail-title">
              <AlarmIndicator priority={selected.priority} indication={alarmIndication(selected)} size={28} />
              <h2>{i18n.alarmText(selected)}</h2>
            </div>
            <dl className="detail-facts">
              <dt>Area</dt>
              <dd className="mono">{selected.area}</dd>
              <dt>Alarm name</dt>
              <dd className="mono">{selected.name}</dd>
              <dt>Condition</dt>
              <dd className="mono">{selected.condition}</dd>
              <dt>Raised at</dt>
              <dd>{i18n.formatDateTime(selected.timestamp, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })}</dd>
              <dt>Severity</dt>
              <dd>
                {i18n.t(`alarm.severity.${selected.severity}`)} → priority {selected.priority}
              </dd>
              <dt>State</dt>
              <dd>
                {i18n.t(`alarm.state.${selected.state}`)} · {selected.acked ? i18n.t("alarm.acked") : i18n.t("alarm.unacked")}
              </dd>
            </dl>
            <p className="note">The text comes from the project dictionary, keyed by alarm name and condition. The API sends only the identifiers.</p>
            <div className="detail-actions">
              {!selected.acked && auth?.can("ackAlarm") && (
                <button type="button" className="kh-btn kh-btn--primary" onClick={() => void store?.ack(selected.instanceId)}>
                  Acknowledge
                </button>
              )}
              {equipment && (
                <button type="button" className="kh-btn" onClick={() => onNavigate(equipment.startsWith("vds.wf.") ? "windfarm" : "substation", equipment)}>
                  Show {i18n.equipmentName(equipment)}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="note">Select an alarm to see its details.</p>
        )}
      </aside>
    </div>
  );
}
