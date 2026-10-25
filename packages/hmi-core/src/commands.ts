/**
 * The command flow: select → confirm → request → track.
 *
 * `select` checks the operator's permission and the command's interlock and
 * starts a selection that expires. `execute` re-checks the interlock, sends the
 * mutation and polls `requestUpdate` until the request reaches a final state.
 * The select/confirm step is client-side: the API has no select-before-operate.
 */

import type { ScadaBackend } from "./backend.ts";
import { FINAL_REQUEST_STATES, type CommandKey, type InterlockState, type RequestUpdate } from "./model.ts";

export type Permission = "view" | "operate" | "bypassInterlock" | "ackAlarm";

export interface Permissions {
  can(permission: Permission): boolean;
}

export interface CommandSelection {
  key: CommandKey;
  /** Analogical commands only. */
  value?: number;
  interlock: InterlockState;
  selectedAt: Date;
  expiresAt: Date;
}

export type CommandStatus = "success" | "blocked" | "denied" | "expired" | "timeout" | "error";

export interface CommandResult {
  status: CommandStatus;
  requestId: string | null;
  updates: readonly RequestUpdate[];
  interlock?: InterlockState;
  error?: unknown;
}

export type SelectResult = { ok: true; selection: CommandSelection } | { ok: false; result: CommandResult };

export interface ExecuteOptions {
  bypassInterlock?: boolean;
  onUpdate?(updates: readonly RequestUpdate[]): void;
}

export interface CommandService {
  select(key: CommandKey, value?: number): Promise<SelectResult>;
  execute(selection: CommandSelection, options?: ExecuteOptions): Promise<CommandResult>;
}

export interface CommandServiceOptions {
  permissions: Permissions;
  /** How long a selection stays valid without confirmation. */
  selectTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Give up waiting for a final request state after this long. */
  requestTimeoutMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const fail = (status: CommandStatus, extra: Partial<CommandResult> = {}): CommandResult => ({
  status,
  requestId: null,
  updates: [],
  ...extra,
});

const byTime = (a: RequestUpdate, b: RequestUpdate) => a.timestamp.getTime() - b.timestamp.getTime();

export function createCommandService(backend: ScadaBackend, options: CommandServiceOptions): CommandService {
  const { permissions } = options;
  const selectTimeoutMs = options.selectTimeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const interlockOf = async (key: CommandKey): Promise<InterlockState> => {
    const [state] = await backend.interlockStates([key]);
    return state ?? { ...key, hasInterlock: false, outcome: "PERMIT" };
  };

  return {
    async select(key, value) {
      if (!permissions.can("operate")) return { ok: false, result: fail("denied") };
      try {
        const interlock = await interlockOf(key);
        const selectedAt = now();
        const selection: CommandSelection = {
          key,
          interlock,
          selectedAt,
          expiresAt: new Date(selectedAt.getTime() + selectTimeoutMs),
          ...(value !== undefined ? { value } : {}),
        };
        return { ok: true, selection };
      } catch (error) {
        return { ok: false, result: fail("error", { error }) };
      }
    },

    async execute(selection, opts = {}) {
      const bypass = opts.bypassInterlock ?? false;
      if (!permissions.can("operate")) return fail("denied");
      if (bypass && !permissions.can("bypassInterlock")) return fail("denied");
      if (now().getTime() > selection.expiresAt.getTime()) return fail("expired");

      let requestId: string;
      try {
        if (!bypass) {
          const interlock = await interlockOf(selection.key);
          if (interlock.outcome === "BLOCK") return fail("blocked", { interlock });
        }
        requestId = await backend.sendCommand(selection.key, {
          bypassInterlock: bypass,
          ...(selection.value !== undefined ? { value: selection.value } : {}),
        });
      } catch (error) {
        return fail("error", { error });
      }

      const deadline = now().getTime() + requestTimeoutMs;
      let updates: RequestUpdate[] = [];
      for (;;) {
        try {
          updates = (await backend.requestUpdates(requestId)).sort(byTime);
          opts.onUpdate?.(updates);
        } catch (error) {
          return { status: "error", requestId, updates, error };
        }
        const last = updates.at(-1);
        if (last && FINAL_REQUEST_STATES.has(last.state)) {
          const status: CommandStatus =
            last.state === "REQUEST_SUCCESS" ? "success" : last.state === "REQUEST_TIMEOUT" ? "timeout" : "error";
          return { status, requestId, updates };
        }
        if (now().getTime() >= deadline) return { status: "timeout", requestId, updates };
        await sleep(pollIntervalMs);
      }
    },
  };
}
