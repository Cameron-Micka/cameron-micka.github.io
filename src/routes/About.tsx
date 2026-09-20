import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { TopNav } from '@/ui/TopNav';
import { SITE, SOCIAL } from '@/ui/strings';
import { companies } from '@/content/companies';
import { tenureLabel } from '@/content/schema';

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
      <TopNav solid />
      <main id="main-content" className="page about-page" tabIndex={-1}>
        <header className="about-header">
          <div>
            <p className="eyebrow">{SITE.role}</p>
            <h1>About</h1>
            <p className="lede">{SITE.tagline}</p>
          </div>
          <figure className="profile-photo">
            <img
              src="https://avatars.githubusercontent.com/Cameron-Micka?s=360"
              alt={`Portrait of ${SITE.name}`}
              width={180}
              height={180}
              decoding="async"
            />
          </figure>
        </header>
        <p>
          I'm {SITE.name}, a {SITE.role.toLowerCase()} with a career spent close
          to the metal — building real-time rendering systems, engine tools, and
          the shaders that make virtual worlds feel alive. My work spans mixed
          reality at Microsoft and console game development at studios like Fun
          Bits Interactive and LucasArts, all rooted in a real-time graphics
          education at DigiPen.
        </p>
        <p>
          This site is itself a small engine: the{' '}
          <Link to="/">landing page</Link> renders a 3D "time machine" of my
          career with WebGPU (falling back to WebGL2), where each planet is a
          place I've worked and each glowing point opens a story.
        </p>
        <p>
          You can also find my credits on{' '}
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
                        <Link to={`/#/${c.slug}/${poi.slug}`}>
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
          src="/golden-record-about.svg"
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
