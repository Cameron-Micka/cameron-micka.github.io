import { tenureLabel, type Company } from '@/content/schema';
import { SITE, SOCIAL } from './strings';

// Semantic, crawlable representation of the same content the 3D scene shows.
// Visually hidden on screen, but exposed to search engines, screen readers,
// and printing (see styles.css print + .visually-hidden rules).
export function ResumeContent({ companies }: { companies: Company[] }) {
  return (
    <main className="visually-hidden" aria-label="Résumé">
      <h1>{SITE.name}</h1>
      <p>{SITE.role}</p>
      <p>{SITE.tagline}</p>
      <ul>
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
      {companies.map((c) => (
        <section key={c.slug}>
          <h3>
            {c.name} — {c.role}
          </h3>
          <p>
            {tenureLabel(c.start, c.end)}
            {c.location ? ` · ${c.location}` : ''}
          </p>
          <p>{c.summary}</p>
          <ul>
            {c.pois.map((p) => (
              <li key={p.slug}>
                <strong>{p.title}.</strong> {p.body}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
