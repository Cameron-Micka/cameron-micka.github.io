import { useEngineSnapshot } from './EngineContext';

export function DebugHud() {
  const { debugHud, stats, backend, activeTier, freeCameraState } =
    useEngineSnapshot();
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
      {freeCameraState && (
        <>
          <div>
            pos {freeCameraState.position[0].toFixed(2)},{' '}
            {freeCameraState.position[1].toFixed(2)},{' '}
            {freeCameraState.position[2].toFixed(2)}
          </div>
          <div>
            yaw {freeCameraState.yawDeg.toFixed(1)}° · pitch{' '}
            {freeCameraState.pitchDeg.toFixed(1)}°
          </div>
        </>
      )}
    </div>
  );
}
