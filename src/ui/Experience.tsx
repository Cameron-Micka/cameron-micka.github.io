import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, Play, Video } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { Company } from '@/content/schema';
import { Engine } from '@/engine/Engine';
import { WebGPUCanvasError } from '@/engine/types';
import { EngineContext, useEngine, useEngineValue } from './EngineContext';
import { SoundManager } from './SoundManager';
import { TopNav } from './TopNav';
import { SideRuler } from './SideRuler';
import { BottomRibbon } from './BottomRibbon';
import { PoiModal } from './PoiModal';
import { SettingsPanel } from './SettingsPanel';
import { DebugHud } from './DebugHud';
import { PortfolioFallback, ResumeContent } from './ResumeContent';
import { HINTS, INTRO, UI } from './strings';

function SoundBridge() {
  const engine = useEngine();
  const enabled = useEngineValue((s) => s.sound);
  useEffect(() => {
    if (!enabled) return;
    const sound = new SoundManager(engine);
    sound.setEnabled(true);
    return () => sound.destroy();
  }, [engine, enabled]);
  return null;
}

// Keeps window.location.hash in sync with the open POI for deep-linking.
function HashBridge() {
  const engine = useEngine();
  const { hash } = useLocation();

  useEffect(() => {
    const apply = () => {
      if (!location.hash) {
        engine.closePoi();
        return;
      }
      const match = location.hash.match(/^#\/([^/]+)\/([^/]+)$/);
      if (!match) return;
      try {
        engine.openPoiRef(
          decodeURIComponent(match[1]!),
          decodeURIComponent(match[2]!),
        );
      } catch (error) {
        if (!(error instanceof URIError)) throw error;
        console.warn('Could not read the project link:', error);
      }
    };
    const offOpen = engine.events.on('poiOpened', (poi) => {
      const next = `#/${poi.company}/${poi.poi}`;
      if (location.hash !== next) history.replaceState(history.state, '', next);
    });
    const offClose = engine.events.on('poiClosed', () => {
      if (location.hash.startsWith('#/')) {
        history.replaceState(
          history.state,
          '',
          location.pathname + location.search,
        );
      }
    });
    window.addEventListener('hashchange', apply);
    apply();
    return () => {
      offOpen();
      offClose();
      window.removeEventListener('hashchange', apply);
    };
  }, [engine, hash]);

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
        <div
          className="loading-track"
          role="progressbar"
          aria-label={UI.loading}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-label">{state.label}</div>
        <Link className="loading-skip" to="/about">
          Skip 3D &amp; read about me{' '}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function Experience({ companies }: { companies: Company[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [startError, setStartError] = useState<Error | null>(null);
  const [retryWithWebGL, setRetryWithWebGL] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const eng = new Engine(
      canvas,
      companies,
      retryWithWebGL ? 'webgl2' : undefined,
    );
    let active = true;
    setEngine(eng);
    eng.start().catch((err: unknown) => {
      if (!active) return;
      eng.destroy();
      if (err instanceof WebGPUCanvasError && !retryWithWebGL) {
        console.warn('Retrying WebGL2 with a fresh canvas:', err.cause);
        setEngine(null);
        setRetryWithWebGL(true);
        return;
      }
      console.error('The 3D timeline could not start:', err);
      setStartError(err instanceof Error ? err : new Error(String(err)));
    });
    return () => {
      active = false;
      eng.destroy();
    };
  }, [companies, retryWithWebGL]);

  if (startError) {
    return <PortfolioFallback companies={companies} error={startError} />;
  }

  return (
    <>
      <ResumeContent companies={companies} printOnly />
      <canvas
        key={retryWithWebGL ? 'webgl2' : 'initial'}
        ref={canvasRef}
        className="scene-canvas"
        aria-hidden="true"
      />
      {engine && (
        <EngineContext.Provider value={engine}>
          <LoadingBar />
          <BodySelectionOutline />
          <TopNav
            onToggleSettings={() => setSettingsOpen((o) => !o)}
            settingsOpen={settingsOpen}
          />
          <main
            id="main-content"
            className="overlay"
            aria-label="Interactive career timeline"
            tabIndex={-1}
          >
            <SceneIntro companies={companies} />
            <div className="timeline-controls">
              <SideRuler companies={companies} />
              <FreeCameraButton />
            </div>
            <FreeCameraHint />
            <BottomRibbon companies={companies} />
            <PoiModal companies={companies} />
            {settingsOpen && <SettingsPanel onClose={closeSettings} />}
            <DebugHud />
          </main>
          <SoundBridge />
          <HashBridge />
        </EngineContext.Provider>
      )}
    </>
  );
}

function SceneIntro({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const focusedIndex = useEngineValue((s) => s.focusedIndex);
  const hidden = useEngineValue((s) => s.freeCamera || s.openPoi !== null);
  const hintDismissed = useEngineValue((s) => s.sceneHintDismissed);
  const company = companies[focusedIndex];
  const firstPoi = company?.pois[0];

  return (
    <section
      className="scene-intro"
      hidden={hidden}
      aria-labelledby="intro-title"
    >
      <h1 id="intro-title">{INTRO.title}</h1>
      <p className="intro-body">{INTRO.body}</p>
      <div className="intro-actions">
        <button
          type="button"
          className="action-link primary"
          aria-haspopup="dialog"
          disabled={!firstPoi}
          onClick={() => {
            if (company && firstPoi)
              engine.openPoiRef(company.slug, firstPoi.slug);
          }}
        >
          {INTRO.explore} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      {!hintDismissed && (
        <p className="scene-hint">
          <span className="hint-desktop">{HINTS.scrubDesktop}</span>
          <span className="hint-touch">{HINTS.scrubTouch}</span>
        </p>
      )}
    </section>
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
  const freeCamera = useEngineValue((s) => s.freeCamera);
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
          <span className="freecam-hint-desktop">
            {HINTS.freeCameraDesktop.map(({ action, detail }, index) => (
              <span key={action}>
                {index > 0 && ' · '}
                <strong>{action}</strong>
                {detail}
              </span>
            ))}
          </span>
          <span className="freecam-hint-touch">
            <strong>{HINTS.freeCameraTouch.flyAction}</strong>
            {HINTS.freeCameraTouch.flyDetail}
            <br />
            <strong>{HINTS.freeCameraTouch.moveAction}</strong>
            {HINTS.freeCameraTouch.moveDetail}
          </span>
        </div>
      )}
    </div>
  );
}

// Round toggle for the free-fly camera.
function FreeCameraButton() {
  const engine = useEngine();
  const freeCamera = useEngineValue((s) => s.freeCamera);
  const yaw = useEngineValue((s) => s.freeCameraState?.yawDeg ?? 0);
  const motionPaused = useEngineValue((s) => s.motionPaused);
  const iconRef = useRef<SVGSVGElement>(null);
  const angleRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  // The icon points right; yaw zero faces -Z (up in a top-down XZ view).
  const targetAngle = freeCamera ? yaw - 90 : 0;

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;
    if (!freeCamera || motionPaused) {
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
  }, [freeCamera, motionPaused, targetAngle]);

  return (
    <div className="freecam">
      <button
        type="button"
        className="icon-btn freecam-btn"
        aria-label={motionPaused ? UI.resume : UI.pause}
        title={motionPaused ? UI.resume : UI.pause}
        aria-pressed={motionPaused}
        onClick={() => engine.setReducedMotion(motionPaused ? 'off' : 'on')}
      >
        {motionPaused ? (
          <Play size={17} aria-hidden="true" />
        ) : (
          <Pause size={17} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="icon-btn freecam-btn"
        aria-label={UI.freeCamera}
        title={UI.freeCamera}
        aria-pressed={freeCamera}
        onClick={() => {
          engine.setFreeCamera(!freeCamera);
          if (!freeCamera) {
            document
              .getElementById('main-content')
              ?.focus({ preventScroll: true });
          }
        }}
      >
        <Video ref={iconRef} size={19} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>
  );
}
