import { TopNav } from '@/ui/TopNav';
import { SOCIAL } from '@/ui/strings';

const LINKS = [
  { label: 'GitHub', href: SOCIAL.github, sub: 'Cameron-Micka' },
  { label: 'LinkedIn', href: SOCIAL.linkedin, sub: 'in/tcmicka' },
  { label: 'Bluesky', href: SOCIAL.bluesky, sub: '@tcmicka.bsky.social' },
  { label: 'X', href: SOCIAL.x, sub: '@tcmicka' },
];

export default function Contact() {
  return (
    <>
      <TopNav solid />
      <article className="page">
        <h1>Contact</h1>
        <p className="lede">
          The fastest ways to reach me. I'm always happy to talk graphics,
          engines, and real-time rendering.
        </p>
        <ul className="social-list">
          {LINKS.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                target={l.href.startsWith('http') ? '_blank' : undefined}
                rel={l.href.startsWith('http') ? 'noreferrer' : undefined}
              >
                <strong>{l.label}</strong>
                <span style={{ color: 'var(--muted)' }}>{l.sub}</span>
              </a>
            </li>
          ))}
        </ul>
      </article>
    </>
  );
}
