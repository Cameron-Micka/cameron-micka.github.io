import { tenureLabel, type Company } from '@/content/schema';
import { Markdown } from './Markdown';
import { TopNav } from './TopNav';
import { SITE, SOCIAL, UI } from './strings';

export function PortfolioFallback({
  companies,
  error,
}: {
  companies: Company[];
  error?: Error;
}) {
  return (
    <>
      <TopNav solid />
      <main id="main-content" className="page resume-page" tabIndex={-1}>
        {error && (
          <section className="fallback-notice" role="alert">
            <h2>{UI.errorTitle}</h2>
            <p>{UI.errorBody}</p>
            <button className="action-link" onClick={() => location.reload()}>
              {UI.reload}
            </button>
            <details>
              <summary>{UI.details}</summary>
              <pre>{error.message}</pre>
            </details>
          </section>
        )}
        <ResumeContent companies={companies} />
      </main>
    </>
  );
}

export function ResumeContent({
  companies,
  printOnly = false,
}: {
  companies: Company[];
  printOnly?: boolean;
}) {
  return (
    <article
      className={`resume-content${printOnly ? ' print-only' : ''}`}
      aria-label="Résumé"
    >
      <h1>{SITE.name}</h1>
      <p className="eyebrow">{SITE.role}</p>
      <p className="lede">{SITE.tagline}</p>
      <ul className="resume-links">
        <li>
          <a href={SOCIAL.linkedin}>LinkedIn</a>
        </li>
        <li>
          <a href={SOCIAL.github}>GitHub</a>
        </li>
        <li>
          <a href={SOCIAL.bluesky}>Bluesky</a>
        </li>
      </ul>
      <h2>Experience</h2>
      {[...companies].reverse().map((c) => (
        <section key={c.slug}>
          <h3>
            {c.name} — {c.role}
          </h3>
          <p>
            {tenureLabel(c.start, c.end)}
            {c.location ? ` · ${c.location}` : ''}
          </p>
          <p>{c.summary}</p>
          <div className="resume-stories">
            {c.pois.map((p) => (
              <section
                key={p.slug}
                id={printOnly ? undefined : `/${c.slug}/${p.slug}`}
              >
                <h4>{p.title}</h4>
                <Markdown text={p.body} />
              </section>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
