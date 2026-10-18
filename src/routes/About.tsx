import { useEffect } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { AboutIntro } from '@/ui/AboutIntro';
import { TopNav } from '@/ui/TopNav';
import { SITE, SOCIAL, UI } from '@/ui/strings';
import { companies } from '@/content/companies';
import { tenureLabel, assetUrl } from '@/content/schema';

const CONTACT_LINKS = [
  { label: 'GitHub', href: SOCIAL.github, sub: 'Cameron-Micka' },
  { label: 'LinkedIn', href: SOCIAL.linkedin, sub: 'in/tcmicka' },
  { label: 'Bluesky', href: SOCIAL.bluesky, sub: '@tcmicka.bsky.social' },
  { label: 'X', href: SOCIAL.x, sub: '@tcmicka' },
];

export default function About() {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === '#contact') {
      document.getElementById('contact')?.scrollIntoView();
    }
  }, [hash]);

  return (
    <>
      <TopNav />
      <main id="main-content" className="page about-page" tabIndex={-1}>
        <header className="about-header">
          <div>
            <p className="eyebrow">{SITE.role}</p>
            <h1>About</h1>
            <p className="lede">{SITE.tagline}</p>
          </div>
          <figure className="profile-photo">
            <img
              src={SITE.photo}
              alt={`Portrait of ${SITE.name}`}
              width={180}
              height={180}
              decoding="async"
            />
          </figure>
        </header>
        <AboutIntro />
        <p>
          You can also find my game credits on{' '}
          <a
            href="https://www.mobygames.com/person/399970/cameron-micka/"
            target="_blank"
            rel="noopener noreferrer"
          >
            MobyGames
          </a>
          .
        </p>

        <section id="experience">
          <h2>Experience, chapter by chapter</h2>
          <p className="highlight-legend">
            <Sparkles size={14} aria-hidden="true" />
            {UI.highlightLegend}
          </p>
          <ol className="career-list">
            {[...companies].reverse().map((c) => (
              <li key={c.slug}>
                <p className="career-dates">{tenureLabel(c.start, c.end)}</p>
                <div>
                  <h3>{c.name}</h3>
                  <p className="career-role">{c.role}</p>
                  <p>{c.summary}</p>
                  <ul
                    className="story-links"
                    aria-label={`${c.name} project stories`}
                  >
                    {c.pois.map((poi) => (
                      <li key={poi.slug}>
                        <Link
                          to={`/#/${c.slug}/${poi.slug}`}
                          className={poi.highlight ? 'highlight' : undefined}
                        >
                          {poi.highlight && (
                            <Sparkles
                              size={14}
                              role="img"
                              aria-label={UI.careerHighlight}
                            />
                          )}
                          {poi.title}{' '}
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section id="contact">
          <h2>Contact</h2>
          <p className="lede">
            I'm always happy to chat about real-time rendering, design to code,
            game development, career paths, or whatever else you're exploring.
          </p>
          <ul className="social-list">
            {CONTACT_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                >
                  <strong>{link.label}</strong>
                  <span className="social-handle">{link.sub}</span>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <img
          className="golden-record"
          src={assetUrl('golden-record-about.svg')}
          alt=""
          width={660}
          height={220}
          loading="lazy"
          decoding="async"
        />
      </main>
    </>
  );
}
