import { useEngineSnapshot, useEngineValue } from './EngineContext';

export function DebugHud() {
  const enabled = useEngineValue((s) => s.debugHud);
  return enabled ? <DebugReadout /> : null;
}

function DebugReadout() {
  const { stats, backend, activeTier, freeCameraState, motionPaused } =
    useEngineSnapshot();
  return (
    <div className="hud" aria-hidden="true">
      <div>
        {backend} · {activeTier}
      </div>
      <div>
        {motionPaused && stats.fps === 0
          ? 'Paused · on demand'
          : `${stats.fps} fps`}
      </div>
      <div>frame {stats.frameMs.toFixed(1)} ms</div>
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
