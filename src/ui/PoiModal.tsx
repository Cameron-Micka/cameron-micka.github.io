import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  X,
} from 'lucide-react';
import { tenureLabel, type Company, type Media } from '@/content/schema';
import { useEngine, useEngineValue } from './EngineContext';
import { Markdown } from './Markdown';
import { UI } from './strings';

// Extract a YouTube video id from common URL shapes (youtu.be/ID,
// youtube.com/watch?v=ID, youtube.com/embed/ID, youtube.com/shorts/ID).
// Returns null for anything that isn't recognizable as YouTube.
function youtubeId(src: string): string | null {
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([\w-]{6,})/);
      if (m) return m[2] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function YouTubeVideo({ videoId, media }: { videoId: string; media: Media }) {
  const [status, setStatus] = useState<
    'preview' | 'loading' | 'loaded' | 'failed'
  >('preview');
  const title = media.alt ?? 'YouTube video';

  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = window.setTimeout(() => setStatus('failed'), 10_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  return (
    <figure className="youtube-video">
      <div className="youtube-player" aria-busy={status === 'loading'}>
        {(status === 'loading' || status === 'loaded') && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={(event) => {
              if (event.currentTarget.contentDocument === null)
                setStatus('loaded');
            }}
            onError={() => setStatus('failed')}
          />
        )}
        {status !== 'loaded' && (
          <button
            type="button"
            className="youtube-preview"
            aria-label={`Play ${title}`}
            title={`Play ${title}`}
            disabled={status === 'loading'}
            onClick={() => setStatus('loading')}
          >
            <img
              src={
                media.poster ??
                `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
              }
              alt=""
              loading="lazy"
            />
            <span className="youtube-play" aria-hidden="true">
              {status === 'loading' ? (
                <LoaderCircle size={28} />
              ) : (
                <Play size={28} fill="currentColor" />
              )}
            </span>
          </button>
        )}
      </div>
      <figcaption className="youtube-caption">
        <a
          className="youtube-link"
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Watch ${title} on YouTube`}
        >
          Watch on YouTube
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        {status === 'failed' && (
          <span role="status">YouTube couldn't load here.</span>
        )}
      </figcaption>
    </figure>
  );
}

function MediaItem({ m }: { m: Media }) {
  if (m.type === 'video') {
    const yt = youtubeId(m.src);
    if (yt) {
      return <YouTubeVideo videoId={yt} media={m} />;
    }
    return (
      <video controls poster={m.poster} preload="metadata">
        <source src={m.src} />
      </video>
    );
  }
  return <img src={m.src} alt={m.alt ?? ''} loading="lazy" decoding="async" />;
}

type Entry = {
  key: string;
  company: Company;
  poi: Company['pois'][number];
  /** 1-based position of the POI within its own company. */
  ordinal: number;
};

export function PoiModal({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const openPoi = useEngineValue((s) => s.openPoi);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  // Key of the POI the list is currently parked on. Kept in a ref so the
  // scroll handler and the "openPoi changed elsewhere" effect can tell who
  // moved last and avoid fighting each other.
  const activeKey = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Every POI across every company, in timeline order, so scrolling walks the
  // whole career the same way the old prev/next buttons did.
  const entries = useMemo<Entry[]>(
    () =>
      [...companies].reverse().flatMap((company) =>
        company.pois.map((poi, i) => ({
          key: `${company.slug}/${poi.slug}`,
          company,
          poi,
          ordinal: i + 1,
        })),
      ),
    [companies],
  );

  const openKey = openPoi ? `${openPoi.company}/${openPoi.poi}` : null;
  const isOpen = openKey !== null && entries.some((e) => e.key === openKey);

  useEffect(() => {
    if (!isOpen) {
      setExpanded(false);
      activeKey.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    listRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !openKey || openKey === activeKey.current) return;
    activeKey.current = openKey;
    const list = listRef.current;
    const section = sectionRefs.current.get(openKey);
    if (list && section) list.scrollTop = section.offsetTop;
  }, [isOpen, openKey]);

  if (!isOpen || !openKey) return null;

  // The company owning the POI in view drives both the header title and the
  // accent bar, so the bar only changes color when the company changes.
  const activeCompany = entries.find((e) => e.key === openKey)?.company;

  // The POI whose section currently sits at the top of the viewport wins; at
  // the very bottom of the list the last POI always wins, since a short final
  // section may not be able to scroll all the way up.
  const activeFromScroll = (list: HTMLElement): string | null => {
    if (entries.length === 0) return null;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) {
      return entries[entries.length - 1]!.key;
    }
    const probe = list.scrollTop + 24;
    let key = entries[0]!.key;
    for (const entry of entries) {
      const section = sectionRefs.current.get(entry.key);
      if (!section) continue;
      if (section.offsetTop <= probe) key = entry.key;
      else break;
    }
    return key;
  };

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const key = activeFromScroll(list);
    if (!key || key === activeKey.current) return;
    activeKey.current = key;
    const entry = entries.find((e) => e.key === key);
    if (entry) engine.openPoiRef(entry.company.slug, entry.poi.slug);
  };

  const titleId = (key: string) => `poi-title-${key.replace('/', '--')}`;

  return (
    <dialog
      ref={dialogRef}
      className="modal-scrim"
      aria-labelledby={titleId(openKey)}
      onCancel={(e) => {
        e.preventDefault();
        engine.closePoi();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          engine.closePoi();
        }
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) engine.closePoi();
      }}
    >
      <div
        className={expanded ? 'modal poi-modal expanded' : 'modal poi-modal'}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span
              className="accent-bar"
              style={{ background: activeCompany?.palette.high }}
              aria-hidden="true"
            />
            <span className="company-name">{activeCompany?.name}</span>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={expanded ? UI.collapse : UI.expand}
              title={expanded ? UI.collapse : UI.expand}
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <Minimize2 size={17} aria-hidden="true" />
              ) : (
                <Maximize2 size={17} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-btn close"
              aria-label={UI.close}
              title={UI.close}
              onClick={() => engine.closePoi()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="project-jump">
            <label htmlFor="project-jump">{UI.projectJump}</label>
            <div className="project-jump-control">
              <select
                id="project-jump"
                aria-label={UI.projectJump}
                value={openKey}
                onChange={(event) => {
                  const entry = entries.find(
                    (item) => item.key === event.target.value,
                  );
                  if (entry)
                    engine.openPoiRef(entry.company.slug, entry.poi.slug);
                }}
              >
                {[...companies].reverse().map((company) => (
                  <optgroup key={company.slug} label={company.name}>
                    {company.pois.map((poi) => (
                      <option
                        key={poi.slug}
                        value={`${company.slug}/${poi.slug}`}
                      >
                        {poi.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown
                className="project-jump-caret"
                size={16}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div
          className="modal-content poi-list"
          ref={listRef}
          onScroll={onScroll}
          tabIndex={-1}
          aria-label={UI.poiList}
        >
          {entries.map((entry) => (
            <section
              className="poi-section"
              key={entry.key}
              aria-labelledby={titleId(entry.key)}
              aria-current={entry.key === openKey ? 'true' : undefined}
              ref={(el) => {
                if (el) sectionRefs.current.set(entry.key, el);
                else sectionRefs.current.delete(entry.key);
              }}
            >
              <h2 id={titleId(entry.key)}>
                <span>
                  <span className="poi-index">{entry.ordinal}.</span>{' '}
                  {entry.poi.title}
                </span>
              </h2>
              <div className="body">
                <p className="story-meta">
                  {entry.company.name} ·{' '}
                  {tenureLabel(entry.company.start, entry.company.end)}
                </p>
                <Markdown text={entry.poi.body} />
              </div>
              {entry.poi.media.length > 0 && (
                <div className="media">
                  {entry.poi.media.map((m, i) => (
                    <MediaItem key={i} m={m} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
