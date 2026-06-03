import { useEngine, useEngineSnapshot } from './EngineContext';
import type { QualityPreference } from '@/engine/QualityManager';
import type { ReducedMotionPref } from '@/settings';
import { UI } from './strings';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const s = useEngineSnapshot();

  return (
    <div className="settings" role="dialog" aria-label={UI.settings}>
      <h3>{UI.settings}</h3>

      <div className="row">
        <label htmlFor="set-quality">Quality</label>
        <select
          id="set-quality"
          value={s.quality}
          onChange={(e) =>
            engine.setQualityPreference(e.target.value as QualityPreference)
          }
        >
          <option value="auto">Auto</option>
          <option value="high">High</option>
          <option value="med">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="row">
        <label htmlFor="set-motion">Motion</label>
        <select
          id="set-motion"
          value={s.reducedMotion}
          onChange={(e) =>
            engine.setReducedMotion(e.target.value as ReducedMotionPref)
          }
        >
          <option value="auto">System</option>
          <option value="off">Full motion</option>
          <option value="on">Reduced</option>
        </select>
      </div>

      <div className="row">
        <label htmlFor="set-sound">Sound</label>
        <input
          id="set-sound"
          type="checkbox"
          checked={s.sound}
          onChange={(e) => engine.setSound(e.target.checked)}
        />
      </div>

      <div className="row">
        <label htmlFor="set-debug">Debug HUD</label>
        <input
          id="set-debug"
          type="checkbox"
          checked={s.debugHud}
          onChange={(e) => engine.setDebugHud(e.target.checked)}
        />
      </div>

      <div className="row">
        <label htmlFor="set-wireframe">Wireframe</label>
        <input
          id="set-wireframe"
          type="checkbox"
          checked={s.wireframe}
          onChange={(e) => engine.setWireframe(e.target.checked)}
        />
      </div>

      <div className="row">
        <label htmlFor="set-freecam">Free camera</label>
        <input
          id="set-freecam"
          type="checkbox"
          checked={s.freeCamera}
          onChange={(e) => engine.setFreeCamera(e.target.checked)}
        />
      </div>
      {s.freeCamera && (
        <div
          className="row"
          style={{ color: 'var(--muted)', fontSize: 12, marginTop: -4 }}
        >
          WASD to fly · Shift to boost · Space to creep · drag to look
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          Renderer: {s.backend ?? '—'} · {s.activeTier}
        </span>
        <button
          type="button"
          className="navlink"
          onClick={onClose}
          style={{ border: '1px solid var(--glass-border)' }}
        >
          {UI.close}
        </button>
      </div>
    </div>
  );
}
