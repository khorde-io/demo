import { AlarmHistoryList, AlarmIndicator, AlarmList, alarmIndication, useAlarms, useHmi, useI18n } from "@khorde/hmi-react";
import { useMemo, useState } from "react";

const AREAS = [
  { label: "Substation", patterns: ["vds.sub.>"] },
  { label: "Wind farm", patterns: ["vds.wf.>"] },
];

/** The live list with a detail panel, and the history of the last hour. */
export function AlarmsPage() {
  const i18n = useI18n();
  const { alarms: store, auth } = useHmi();
  const { alarms } = useAlarms();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = alarms.find((a) => a.instanceId === selectedId) ?? null;
  // The history window is fixed when the page opens.
  const [range] = useState(() => ({ from: new Date(Date.now() - 3600e3), to: new Date(Date.now() + 60e3) }));
  const historyFilter = useMemo(() => ({}), []);

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
            {!selected.acked && auth?.can("ackAlarm") && (
              <button type="button" className="kh-btn kh-btn--primary" onClick={() => void store?.ack(selected.instanceId)}>
                Acknowledge
              </button>
            )}
          </>
        ) : (
          <p className="note">Select an alarm to see its details.</p>
        )}
      </aside>
      <section className="page-panel page-wide">
        <h2 className="eyebrow">Alarm history · last hour</h2>
        <AlarmHistoryList from={range.from} to={range.to} filter={historyFilter} />
      </section>
    </div>
  );
}
