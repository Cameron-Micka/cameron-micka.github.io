import { useEngineSnapshot } from './EngineContext';

export function DebugHud() {
  const { debugHud, stats, backend, activeTier } = useEngineSnapshot();
  if (!debugHud) return null;
  return (
    <div className="hud" aria-hidden="true">
      <div>
        {backend} · {activeTier}
      </div>
      <div>{stats.fps} fps</div>
      <div>draws {stats.drawCalls}</div>
      <div>tris {stats.triangles.toLocaleString()}</div>
      <div>mem ~{stats.gpuMemoryMB.toFixed(1)} MB</div>
    </div>
  );
}
