/**
 * Every GraphQL operation the HMI sends, in one place. `documents.test.ts`
 * validates them against `schema.graphql`, so a schema change that breaks one
 * fails the build instead of a screen.
 */

const MEASUREMENT = "name equipment timestamp type value quality";
const ACTIVE_ALARM =
  "key origin name area condition instanceId state severity value setAt stateAt ack ackedAt ackedBy originOnline";
const JOURNAL_ENTRY = "timestamp kind origin name area condition instanceId state value severity ack ackedAt ackedBy";

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
  query HistAnalogical($paths: [String!]!, $timestamp: TimestampFilter, $order: HistOrder!, $first: Int!, $after: String) {
    histAnalogical(paths: $paths, timestamp: $timestamp, order: $order, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${MEASUREMENT} }
    }
  }
`;

export const HIST_DISCRETE = /* GraphQL */ `
  query HistDiscrete($paths: [String!]!, $timestamp: TimestampFilter, $order: HistOrder!, $first: Int!, $after: String) {
    histDiscrete(paths: $paths, timestamp: $timestamp, order: $order, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${MEASUREMENT} }
    }
  }
`;

export const ACTIVE_ALARM_CHANGES = /* GraphQL */ `
  subscription ActiveAlarmChanges($areas: [String!]!) {
    activeAlarmChanges(areas: $areas) {
      kind
      instanceId
      alarm { ${ACTIVE_ALARM} }
    }
  }
`;

export const ALARM_JOURNAL = /* GraphQL */ `
  query AlarmJournal($filter: AlarmFilter, $order: HistOrder!, $first: Int!, $after: String) {
    alarmJournal(filter: $filter, order: $order, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${JOURNAL_ENTRY} }
    }
  }
`;

export const ACK_ALARM = /* GraphQL */ `
  mutation AckAlarm($key: ID!, $instanceId: UUID!) {
    ackAlarm(key: $key, instanceId: $instanceId) { status }
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
