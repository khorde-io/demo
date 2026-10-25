/**
 * A minimal observable value. Every stateful service exposes its state this way
 * (`get` + `subscribe`), which maps directly onto React's `useSyncExternalStore`
 * and is easy to adapt to any other framework.
 */

export type Listener = () => void;
export type Unsubscribe = () => void;

export interface Readable<T> {
  get(): T;
  subscribe(listener: Listener): Unsubscribe;
}

export interface Writable<T> extends Readable<T> {
  set(next: T): void;
  update(fn: (current: T) => T): void;
}

export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Runs a flush on the next frame in a browser, else on the next macrotask. */
export type Scheduler = (flush: () => void) => void;

export const frameScheduler: Scheduler = (flush) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => flush());
  else setTimeout(flush, 0);
};

export const syncScheduler: Scheduler = (flush) => flush();
