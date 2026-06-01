import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Engine, EngineSnapshot } from '@/engine/Engine';

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used within EngineContext');
  return engine;
}

export function useEngineSnapshot(): EngineSnapshot {
  const engine = useEngine();
  return useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  );
}
