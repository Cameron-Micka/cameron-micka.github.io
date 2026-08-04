import { useEffect, useRef, useState } from 'react';
import type { Company } from '@/content/schema';
import { Engine } from '@/engine/Engine';
import { EngineContext, useEngine, useEngineSnapshot } from './EngineContext';
import { SoundManager } from './SoundManager';
import { TopNav } from './TopNav';
import { SideRuler } from './SideRuler';
import { BottomRibbon } from './BottomRibbon';
import { PoiModal } from './PoiModal';
import { SettingsPanel } from './SettingsPanel';
import { DebugHud } from './DebugHud';
import { recordError } from './errorLog';
import { UI } from './strings';

function SoundBridge() {
  const engine = useEngine();
  const ref = useRef<SoundManager | null>(null);
  if (!ref.current) ref.current = new SoundManager(engine);
  useEffect(() => {
    ref.current?.setEnabled(true);
    return () => ref.current?.destroy();
  }, []);
  return null;
}

// Keeps window.location.hash in sync with the open POI for deep-linking.
function HashBridge({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { openPoi } = useEngineSnapshot();
  const suppress = useRef(false);

  useEffect(() => {
    const apply = () => {
      const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
      const [company, poi] = raw.split('/');
      if (company && poi && companies.some((c) => c.slug === company)) {
        suppress.current = true;
        engine.openPoiRef(company, poi);
        suppress.current = false;
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [engine, companies]);

  useEffect(() => {
    if (suppress.current) return;
    const next = openPoi ? `#/${openPoi.company}/${openPoi.poi}` : '';
    if (next) {
      if (location.hash !== next) history.replaceState(null, '', next);
    } else if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [openPoi]);

  return null;
}

// Full-screen progress bar shown while the renderer builds geometry and
// compiles shaders, then fades out just before the camera fly-in begins.
function LoadingBar() {
  const engine = useEngine();
  const [state, setState] = useState(() => engine.getLoadState());
  const [dismissed, setDismissed] = useState(() => engine.getLoadState().ready);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    // Reconcile with anything emitted before this effect subscribed.
    const initial = engine.getLoadState();
    setState(initial);
    if (initial.ready) setDismissed(true);

    const off = engine.events.on('loadProgress', (s) => {
      setState(s);
      if (s.ready) setDismissed(true);
    });
    const offReady = engine.events.on('ready', () => setDismissed(true));
    return () => {
      off();
      offReady();
    };
  }, [engine]);

  useEffect(() => {
    if (!dismissed) return;
    const t = window.setTimeout(() => setMounted(false), 600);
    return () => window.clearTimeout(t);
  }, [dismissed]);

  if (!mounted) return null;
  const pct = Math.round(state.frac * 100);
  return (
    <div
      className={`loading-screen${dismissed ? ' is-done' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-card">
        <div className="loading-title">{UI.loading}</div>
        <div className="loading-track">
          <div className="loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-label">{state.label}</div>
      </div>
    </div>
  );
}

export function Experience({ companies }: { companies: Company[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const eng = new Engine(canvas, companies);
    setEngine(eng);
    eng.start().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      recordError('error', `Engine start failed: ${error.message}`, error.stack ?? '');
      setStartError(error);
    });
    return () => eng.destroy();
  }, [companies]);

  return (
    <>
      <canvas ref={canvasRef} className="scene-canvas" aria-hidden="true" />
      {startError && (
        <div className="error-screen">
          <div className="error-card">
            <h1>{UI.errorTitle}</h1>
            <p>{UI.errorBody}</p>
            <pre>{startError.stack ?? startError.message}</pre>
          </div>
        </div>
      )}
      {engine && (
        <EngineContext.Provider value={engine}>
          {!startError && <LoadingBar />}
          <div className="overlay">
            <TopNav onToggleSettings={() => setSettingsOpen((o) => !o)} />
            <SideRuler companies={companies} />
            <BottomRibbon companies={companies} />
            <PoiModal companies={companies} />
            {settingsOpen && (
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            )}
            <FreeCameraButton />
            <DebugHud />
          </div>
          <Backend />
          <SoundBridge />
          <HashBridge companies={companies} />
        </EngineContext.Provider>
      )}
    </>
  );
}

function Backend() {
  const { backend } = useEngineSnapshot();
  if (backend !== 'webgl2') return null;
  return <div className="compat-notice">{UI.webglNotice}</div>;
}

// Round toggle (bottom-right, mirrors the settings button) for the free-fly
// camera. Shows a controls hint while active.
function FreeCameraButton() {
  const engine = useEngine();
  const { freeCamera } = useEngineSnapshot();
  return (
    <div className="freecam">
      {freeCamera && (
        <div className="freecam-hint">
          WASD to fly · Shift to boost · Space to creep · drag to look
        </div>
      )}
      <button
        type="button"
        className={`icon-btn freecam-btn${freeCamera ? ' active' : ''}`}
        aria-label={UI.freeCamera}
        aria-pressed={freeCamera}
        title={UI.freeCamera}
        onClick={() => engine.setFreeCamera(!freeCamera)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 7.5A1.5 1.5 0 0 1 4.5 6h8A1.5 1.5 0 0 1 14 7.5v9A1.5 1.5 0 0 1 12.5 18h-8A1.5 1.5 0 0 1 3 16.5v-9Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M14 10.5l5-2.75v8.5L14 13.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
