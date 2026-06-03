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

function SkipIntro() {
  const engine = useEngine();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const off = engine.events.on('flyInDone', () => setVisible(false));
    const t = window.setTimeout(() => setVisible(false), 3000);
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [engine]);
  if (!visible) return null;
  return (
    <button
      type="button"
      className="skip-btn"
      onClick={() => {
        engine.skipIntro();
        setVisible(false);
      }}
    >
      {HINTS.skip}
    </button>
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
          <div className="overlay">
            <TopNav onToggleSettings={() => setSettingsOpen((o) => !o)} />
            <SideRuler companies={companies} />
            <BottomRibbon companies={companies} />
            <PoiModal companies={companies} />
            {settingsOpen && (
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            )}
            <DebugHud />
            <SkipIntro />
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
