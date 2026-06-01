type Handler<T> = (payload: T) => void;

// Minimal typed pub-sub. The engine owns its state and emits slice-changes;
// React subscribes via useSyncExternalStore without per-frame re-renders.
export class TinyEventEmitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Handler<Events[K]>): void {
    this.handlers[event]?.delete(fn);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers[event]?.forEach((fn) => fn(payload));
  }
}
