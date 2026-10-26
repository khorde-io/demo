export { HmiProvider, useAlarms, useConnection, useHmi, useI18n, usePoint, usePointValues, useReadable, type HmiServices } from "./context.tsx";
export { reactMessages } from "./messages.ts";

// shell
export { AppShell, Footer, Header, bannerAlarm, roleKey, type AppShellProps, type Crumb, type FooterProps, type HeaderProps, type NavItem } from "./shell/shell.tsx";

// symbols
export * from "./symbols/types.ts";
export { AlarmShape, LockBadge, TagBadge } from "./symbols/parts.tsx";
export { Breaker, Busbar, Disconnector, EarthingSwitch, Generator, Line, Load, Transformer2W, type LineProps, type TransformerProps } from "./symbols/electrical.tsx";
export { TURBINE_CODES, WindIndicator, WindTurbine, type TurbineState, type WindIndicatorProps } from "./symbols/wind.tsx";
export { BoundBreaker, BoundDisconnector, BoundEarthingSwitch, BoundWindTurbine, turbineStateOf } from "./symbols/bound.tsx";
export { SymbolSvg } from "./symbols/SymbolSvg.tsx";
export { useEnergization } from "./topology/useEnergization.ts";

// widgets
export { AlarmIndicator, AnalogBar, AnalogValue, StatusDot, alarmIndication, type AnalogBarProps, type AnalogValueProps, type Connectivity } from "./widgets/widgets.tsx";
export { TurbineTile, type TurbineTileProps } from "./widgets/TurbineTile.tsx";

// interlocks
export { InterlockPanel, type InterlockPanelProps } from "./interlock/InterlockPanel.tsx";
export { InterlockLadder, type InterlockLadderProps } from "./interlock/InterlockLadder.tsx";
export { useInterlock } from "./interlock/useInterlock.ts";
export { layoutLadder, DEFAULT_METRICS, type Ladder, type LadderMetrics, type GateBox, type FrameBox, type Wire } from "./interlock/layout.ts";
export { describeCondition, currentValueText, OP_SYMBOL, type ConditionText } from "./interlock/labels.ts";

// alarms
export { AlarmList, type AlarmListProps, type AreaFilter } from "./alarms/AlarmList.tsx";
export { AlarmHistoryList, alarmChanges, changesToCsv, type AlarmChange, type AlarmHistoryListProps } from "./alarms/AlarmHistoryList.tsx";

// faceplate and commands
export { Faceplate, type FaceplateProps, type FaceplateTab } from "./faceplate/Faceplate.tsx";
export { CommandDialog, type CommandDialogProps } from "./faceplate/CommandDialog.tsx";

// trends
export { Sparkline, TrendChart, niceTicks, useTrend, type SparklineProps, type TrendChartProps, type TrendSeries, type TrendState } from "./trend/trend.tsx";

// sign-in
export { AccessDenied, AuthGate, LoginScreen, SessionExpired, gateView, type GateView } from "./auth/AuthGate.tsx";
