/**
 * Every GraphQL operation the HMI sends, in one place. `documents.test.ts`
 * validates them against `schema.graphql`, so a schema change that breaks one
 * fails the build instead of a screen.
 */

const MEASUREMENT = "name equipment timestamp type value quality";
const ALARM =
  "name area condition instanceId timestamp state value severity ack ackTimestamp actorId actorDisplay";

export const MEAS_BY_PATHS = /* GraphQL */ `
  subscription MeasByPaths($paths: [String!]!) {
    measByPaths(paths: $paths) { ${MEASUREMENT} }
  }
`;

export const MEAS_BY_TAG = /* GraphQL */ `
  subscription MeasByTag($tag: String!) {
    measByTag(tag: $tag) { ${MEASUREMENT} }
  }
`;

export const HIST_ANALOGICAL = /* GraphQL */ `
  query HistAnalogical($filter: MeasFilter) {
    histAnalogical(filter: $filter) { ${MEASUREMENT} }
  }
`;

export const HIST_DISCRETE = /* GraphQL */ `
  query HistDiscrete($filter: MeasFilter) {
    histDiscrete(filter: $filter) { ${MEASUREMENT} }
  }
`;

export const ACTIVE_ALARMS = /* GraphQL */ `
  query ActiveAlarms($areas: [String!]!) {
    activeAlm(areas: $areas) { ${ALARM} }
  }
`;

export const ALARM_HISTORY = /* GraphQL */ `
  query AlarmHistory($filter: AlarmFilter) {
    alm(filter: $filter) { ${ALARM} }
  }
`;

export const ALARM_SUBSCRIBE = /* GraphQL */ `
  subscription AlarmSubscribe($areas: [String!]!) {
    almSubscribe(areas: $areas) { ${ALARM} }
  }
`;

export const ALARM_ACK = /* GraphQL */ `
  mutation AlarmAck($instanceId: UUID!) {
    almAck(instanceId: $instanceId)
  }
`;

export const DISCRETE_COMMAND = /* GraphQL */ `
  mutation DiscreteCommand($agent: String!, $equipment: String!, $name: String!, $bypassInterlock: Boolean!) {
    discreteCommandRequest(agent: $agent, equipment: $equipment, name: $name, bypassInterlock: $bypassInterlock)
  }
`;

export const ANALOGICAL_COMMAND = /* GraphQL */ `
  mutation AnalogicalCommand(
    $agent: String!
    $equipment: String!
    $name: String!
    $value: Float!
    $bypassInterlock: Boolean!
  ) {
    analogicalCommandRequest(
      agent: $agent
      equipment: $equipment
      name: $name
      value: $value
      bypassInterlock: $bypassInterlock
    )
  }
`;

export const REQUEST_UPDATE = /* GraphQL */ `
  query RequestUpdate($requestId: String!) {
    requestUpdate(requestId: $requestId) { id name state msg timestamp actorId actorDisplay }
  }
`;

export const INTERLOCK_STATES = /* GraphQL */ `
  query InterlockStates($commands: [CommandKeyInput!]!) {
    commandInterlockStates(commands: $commands) { agent equipment name hasInterlock outcome }
  }
`;

export const INTERLOCK_DETAIL = /* GraphQL */ `
  query InterlockDetail($agent: String!, $equipment: String!, $name: String!) {
    commandInterlockDetail(agent: $agent, equipment: $equipment, name: $name) {
      agent equipment name hasInterlock outcome key description graph
      nodeStates { path state }
    }
  }
`;

export const AGENT_HEARTBEATS = /* GraphQL */ `
  query AgentHeartbeats($agents: [String!]!) {
    agentHeartbeats(agents: $agents) { agent status lastSeenAt }
  }
`;

export const AGENT_HEARTBEAT_SUBSCRIBE = /* GraphQL */ `
  subscription AgentHeartbeatSubscribe($agents: [String!]!) {
    agentHeartbeatSubscribe(agents: $agents) { agent status lastSeenAt }
  }
`;

export const SITE_HEARTBEATS = /* GraphQL */ `
  query SiteHeartbeats($sites: [String!]!) {
    siteHeartbeats(sites: $sites) { site status lastSeenAt }
  }
`;

export const SITE_HEARTBEAT_SUBSCRIBE = /* GraphQL */ `
  subscription SiteHeartbeatSubscribe($sites: [String!]!) {
    siteHeartbeatSubscribe(sites: $sites) { site status lastSeenAt }
  }
`;

export const REGISTERED_MEASUREMENTS = /* GraphQL */ `
  query RegisteredMeasurements($agents: [String!]) {
    registeredMeasurements(agents: $agents) { agent equipment name type }
  }
`;

export const REGISTERED_COMMANDS = /* GraphQL */ `
  query RegisteredCommands($agents: [String!]) {
    registeredCommands(agents: $agents) { agent equipment name }
  }
`;
