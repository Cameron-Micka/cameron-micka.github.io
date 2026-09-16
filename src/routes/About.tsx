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
      <article className="page">
        <h1>About</h1>
        <p className="lede">{SITE.tagline}</p>
        <figure className="profile-photo">
          <img
            src="https://avatars.githubusercontent.com/Cameron-Micka?s=320"
            alt={`Portrait of ${SITE.name}`}
            width={160}
            height={160}
            loading="lazy"
          />
        </figure>
        <p>
          I'm {SITE.name}, a {SITE.role.toLowerCase()} who takes pride in
          handing other creative people superpowers. Fifteen-plus years, a
          drawer full of shipped titles, and a stubborn love for the layer
          right above the silicon: custom engines, renderers, gameplay and AI
          systems, physics, and the design tools that turn "what if" into
          "ship it." My work spans mixed reality at Microsoft and console game
          development at studios like Fun Bits Interactive and LucasArts, all
          rooted in a real-time interactive simulation education at DigiPen.
        </p>
        <p>
          It started with one of the very first games submitted to the iTunes
          App Store — a scrappy little thing Microsoft liked enough to buy for
          the Zune HD. That got me a seat at LucasArts as a gameplay engineer
          on the Star Wars: The Force Unleashed series for Xbox 360 and
          PlayStation 3, where I learned that lightsabers are mostly physics
          problems wearing a great costume.
        </p>
        <p>
          Next came Fun Bits Interactive and Escape Plan, a bestselling
          PlayStation Vita title built on a custom port of Unity. I was
          promoted to Technical Director and led a team of 12 engineers through
          Fat Princess Adventures, a cooperative online multiplayer RPG — while
          building the PlayStation 4 engine underneath it. In 2016 I joined
          Microsoft, where I've been chasing mixed reality ever since.
        </p>
        <p>
          This site is itself a small engine: the{' '}
          <Link to="/">landing page</Link> renders a 3D
          "time machine" of my career with WebGPU (falling back to WebGL2),
          where each planet is a place I've worked and each glowing point opens
          a story.
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

        <section>
          <h2>Where I've worked &amp; studied</h2>
          <ul>
            {companies.map((c) => (
              <li key={c.slug}>
                <strong>{c.name}</strong> — {c.role} (
                {tenureLabel(c.start, c.end)})
              </li>
            ))}
          </ul>
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
      </article>
    </>
  );
}
