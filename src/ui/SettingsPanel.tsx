import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useEngine, useEngineSnapshot } from './EngineContext';
import type { QualityPreference } from '@/engine/QualityManager';
import type { BackendPref } from '@/settings';
import { UI } from './strings';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const s = useEngineSnapshot();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !panelRef.current?.contains(target) &&
        !target.closest('#settings-toggle')
      )
        onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      className="settings"
      id="system-settings"
      role="dialog"
      aria-label={UI.settings}
      tabIndex={-1}
      ref={panelRef}
    >
      <div className="settings-heading">
        <h2>{UI.settings}</h2>
        <button
          type="button"
          className="icon-btn close"
          aria-label={UI.close}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="settings-controls">
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
          <label htmlFor="set-backend">
            Renderer <span className="setting-note">Reloads the page</span>
          </label>
          <select
            id="set-backend"
            value={s.forceBackend}
            onChange={(e) =>
              engine.setForceBackend(e.target.value as BackendPref)
            }
          >
            <option value="auto">Auto</option>
            <option value="webgpu">WebGPU</option>
            <option value="webgl2">WebGL</option>
          </select>
        </div>

        <div className="row">
          <label htmlFor="set-sound">{UI.sound}</label>
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
          <label htmlFor="set-crt">CRT</label>
          <input
            id="set-crt"
            type="checkbox"
            checked={s.crt}
            onChange={(e) => engine.setCrt(e.target.checked)}
          />
        </div>

        <div className="row">
          <label htmlFor="set-flightpath">Flight path</label>
          <input
            id="set-flightpath"
            type="checkbox"
            checked={s.flightPath}
            onChange={(e) => engine.setFlightPath(e.target.checked)}
          />
        </div>
      </div>

      <div className="settings-status">
        <span>
          <span className="status-led" aria-hidden="true" />
          {s.backend?.toUpperCase() ?? 'Starting'}
        </span>
        <span>{s.activeTier.toUpperCase()}</span>
      </div>
    </div>
  );
}
