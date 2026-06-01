import { TopNav } from '@/ui/TopNav';
import { SITE } from '@/ui/strings';
import { companies } from '@/content/companies';

export default function About() {
  return (
    <>
      <TopNav />
      <article className="page">
        <h1>About</h1>
        <p className="lede">{SITE.tagline}</p>
        <p>
          I'm {SITE.name}, a {SITE.role.toLowerCase()} with a career spent close
          to the metal — building real-time rendering systems, engine tools, and
          the shaders that make virtual worlds feel alive. My work spans mixed
          reality at Microsoft and console game development at studios like Fun
          Bits Interactive and LucasArts, all rooted in a real-time graphics
          education at DigiPen.
        </p>
        <p>
          This site is itself a small engine: the landing page renders a 3D
          "time machine" of my career with WebGPU (falling back to WebGL2),
          where each planet is a place I've worked and each glowing point opens a
          story.
        </p>

        <section>
          <h2>Where I've worked</h2>
          <ul>
            {companies.map((c) => (
              <li key={c.slug}>
                <strong>{c.name}</strong> — {c.role} ({c.start}–
                {c.end ?? 'Present'})
              </li>
            ))}
          </ul>
        </section>
      </article>
    </>
  );
}
