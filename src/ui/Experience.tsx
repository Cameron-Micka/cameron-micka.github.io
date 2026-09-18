import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import type { Company } from '@/content/schema';
import { Engine } from '@/engine/Engine';
import { resolveReducedMotion } from '@/settings';
import { EngineContext, useEngine, useEngineSnapshot } from './EngineContext';
import { SoundManager } from './SoundManager';
import { TopNav } from './TopNav';
import { SideRuler } from './SideRuler';
import { BottomRibbon } from './BottomRibbon';
import { PoiModal } from './PoiModal';
import { SettingsPanel } from './SettingsPanel';
import { DebugHud } from './DebugHud';
import { HINTS, UI } from './strings';

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
      setStartError(err instanceof Error ? err : new Error(String(err)));
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
            <pre>{startError.message}</pre>
          </div>
        </div>
      )}
      {engine && (
        <EngineContext.Provider value={engine}>
          {!startError && <LoadingBar />}
          <BodySelectionOutline />
          <div className="overlay">
            <TopNav
              onToggleSettings={() => setSettingsOpen((o) => !o)}
              settingsOpen={settingsOpen}
            />
            <div className="timeline-controls">
              <SideRuler companies={companies} />
              <FreeCameraButton />
            </div>
            <FreeCameraHint />
            <BottomRibbon companies={companies} />
            <PoiModal companies={companies} />
            {settingsOpen && (
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            )}
            <DebugHud />
          </div>
          <SoundBridge />
          <HashBridge companies={companies} />
        </EngineContext.Provider>
      )}
    </>
  );
}

function BodySelectionOutline() {
  const engine = useEngine();
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(
    () =>
      engine.events.on('bodySelectionChanged', (outline) => {
        pathRef.current?.setAttribute('d', outline ?? '');
      }),
    [engine],
  );

  return (
    <svg className="body-selection-outline" aria-hidden="true">
      <path ref={pathRef} />
    </svg>
  );
}

function FreeCameraHint() {
  const { freeCamera } = useEngineSnapshot();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(freeCamera);
    if (!freeCamera) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [freeCamera]);

  return (
    <div className="freecam-hint" role="status" aria-live="polite">
      {freeCamera && visible && (
        <div className="freecam-hint-card">
          <strong>{UI.freeCamera}</strong>
          <span className="freecam-hint-desktop">{HINTS.freeCameraDesktop}</span>
          <span className="freecam-hint-touch">{HINTS.freeCameraTouch}</span>
        </div>
      )}
    </div>
  );
}

// Round toggle for the free-fly camera.
function FreeCameraButton() {
  const engine = useEngine();
  const { freeCamera, freeCameraState, reducedMotion } = useEngineSnapshot();
  const iconRef = useRef<SVGSVGElement>(null);
  const angleRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  // The icon points right; yaw zero faces -Z (up in a top-down XZ view).
  const targetAngle = freeCamera ? (freeCameraState?.yawDeg ?? 0) - 90 : 0;

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;
    if (!freeCamera || resolveReducedMotion(reducedMotion)) {
      angleRef.current = targetAngle;
      lastTimeRef.current = null;
      icon.style.transform = `rotate(${targetAngle}deg)`;
      return;
    }

    let frame = 0;
    const animate = (time: number) => {
      const dt =
        lastTimeRef.current === null
          ? 1 / 60
          : Math.max(0, Math.min(0.05, (time - lastTimeRef.current) / 1000));
      lastTimeRef.current = time;
      // Take the shortest turn, including across the normalized yaw boundary.
      const delta =
        ((((targetAngle - angleRef.current) % 360) + 540) % 360) - 180;
      const settled = Math.abs(delta) < 0.1;
      angleRef.current = settled
        ? targetAngle
        : angleRef.current + delta * (1 - Math.exp(-18 * dt));
      icon.style.transform = `rotate(${angleRef.current}deg)`;
      if (!settled) frame = requestAnimationFrame(animate);
      else lastTimeRef.current = null;
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [freeCamera, reducedMotion, targetAngle]);

  return (
    <div className="freecam">
      <button
        type="button"
        className="icon-btn freecam-btn"
        aria-label={UI.freeCamera}
        aria-pressed={freeCamera}
        title={UI.freeCamera}
        onClick={() => engine.setFreeCamera(!freeCamera)}
      >
        <Video ref={iconRef} size={19} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>
  );
}
