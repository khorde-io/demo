/**
 * English texts for the React library: shell, symbols and widgets. Layer it
 * after `coreMessages` and before the project's catalog:
 * `catalogs: { en: [{ messages: coreMessages }, { messages: reactMessages }, project] }`.
 */
export const reactMessages = {
  shell: {
    mainNav: "Main",
    alarmSummary: "Alarm summary",
    priorityCount: "Priority {priority}: {count} alarms, {unacked} not acknowledged",
    unacked: "{count} unacked",
    noAlarms: "No active alarms",
    latestAlarm: "Latest alarm",
    ack: "Ack",
    alarmList: "Alarm list",
    breadcrumb: "You are here",
    signedInAs: "Signed in as {name}, {role}",
    api: "API {state}",
    agents: "Agents {online}/{total} online",
    sites: "Site link {state}",
    lastUpdate: "Last update {time}",
    role: {
      supervisor: "Supervisor",
      operator: "Operator",
      viewer: "Viewer",
      none: "No SCADA role",
    },
  },
  alarmIndicator: {
    activeUnacked: "Priority {priority} alarm, not acknowledged",
    activeAcked: "Priority {priority} alarm, acknowledged",
    returnedUnacked: "Priority {priority} alarm returned, not acknowledged",
  },
  value: {
    bad: "bad quality",
    stale: "not current",
    noValue: "no value",
  },
  symbol: {
    switch: { open: "Open", closed: "Closed", intermediate: "Intermediate", invalid: "Invalid", unknown: "Unknown" },
    turbine: {
      producing: "Producing",
      waiting: "Waiting for wind",
      stopped: "Stopped",
      fault: "Fault",
      curtailed: "Curtailed",
      unknown: "Comms lost",
    },
    breaker: "Circuit breaker",
    disconnector: "Disconnector",
    earthingSwitch: "Earthing switch",
    transformer: "Transformer",
    generator: "Generator",
    load: "Load",
    windTurbine: "Wind turbine",
    wind: "Wind",
    interlocked: "Interlocked",
    local: "Local control",
    localTag: "L",
    tap: "Tap {tap}",
    energized: "energized",
    deEnergized: "de-energized",
  },
  tile: {
    power: "{value} MW",
    setpoint: "Setpoint {value} MW",
  },
} as const;
