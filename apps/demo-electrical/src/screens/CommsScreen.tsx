import { pointId, type HeartbeatMonitor, type PointId } from "@khorde/hmi-core";
import { StatusDot, useConnection, useI18n, usePointValues, useReadable } from "@khorde/hmi-react";
import { plant } from "../plant.ts";

const COMM: PointId[] = plant.turbines.map((t) => pointId(t.id, "comm"));
const NO_AGENTS: HeartbeatMonitor = { get: () => new Map(), subscribe: () => () => {}, start: async () => {}, stop: () => {} };

/** L4: health of the link to the hub, of each agent, and of each turbine's link to its agent. */
export function CommsScreen({ agents, onOpenTurbine }: { agents: HeartbeatMonitor | null; onOpenTurbine: (id: string) => void }) {
  const i18n = useI18n();
  const connection = useConnection();
  const beats = useReadable(agents ?? NO_AGENTS);
  const comm = usePointValues(COMM);
  const time = (d: Date | null) => (d ? i18n.formatDateTime(d, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : "never");
  return (
    <div className="page page--comms">
      <section className="page-panel">
        <h2 className="eyebrow">Hub link</h2>
        <p className="comms-line">
          <StatusDot status={connection === "online" ? "online" : connection === "idle" ? "unknown" : "offline"} /> {i18n.t(`connection.${connection}`)}
        </p>
        <h2 className="eyebrow">Agents</h2>
        <table className="kh-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Status</th>
              <th scope="col">Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {[...beats.values()].map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td>
                  <StatusDot status={b.status} /> {i18n.t(`heartbeat.${b.status}`)}
                </td>
                <td className="num">{time(b.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="page-panel">
        <h2 className="eyebrow">Turbine communication</h2>
        <ul className="comms-turbines">
          {plant.turbines.map((t) => {
            const v = comm.get(pointId(t.id, "comm"));
            const status = v?.quality !== "good" ? "unknown" : v.value === 1 ? "online" : "offline";
            return (
              <li key={t.id}>
                <button type="button" className={`comms-turbine comms-turbine--${status}`} onClick={() => onOpenTurbine(t.id)}>
                  <StatusDot status={status} /> {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
