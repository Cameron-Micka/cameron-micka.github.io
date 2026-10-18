import { Link } from 'react-router-dom';
import { SITE } from './strings';

// The opening About paragraphs, shared by the About page and the top of the
// story dialog. The dialog already sits on the 3D landing page, so it omits the
// closing note about how this site was built.
export function AboutIntro({ siteNote = true }: { siteNote?: boolean }) {
  return (
    <>
      <p>
        I'm {SITE.name}, a {SITE.role.toLowerCase()} who takes pride in handing
        other creative people superpowers. Fifteen-plus years, a drawer full of
        shipped titles, and a love for simulations, renderers, gameplay and AI
        systems, physics, and the design tools that turn "what if" into "ship
        it." My work spans mixed reality at Microsoft and console game
        development at studios like Fun Bits Interactive and LucasArts, all
        rooted in a real-time interactive simulation education at DigiPen.
      </p>
      <p>
        It started with one of the very first games submitted to the iTunes App
        Store — a scrappy app Microsoft liked enough to buy for the Zune HD.
        That got me a seat at LucasArts as a gameplay engineer on the Star Wars:
        The Force Unleashed series for Xbox 360 and PlayStation 3, where I
        learned that lightsabers are mostly physics problems wearing a great
        costume.
      </p>
      <p>
        Next came Fun Bits Interactive and Escape Plan, a bestselling
        PlayStation Vita title built on a custom port of Unity. I was promoted
        to Technical Director and led a team of 12 engineers through Fat
        Princess Adventures, a cooperative online multiplayer RPG — while
        building a bespoke PlayStation 4 engine underneath it. In 2016 I joined
        Microsoft, where I've focused on mixed reality and bridging the gap
        between design and engineering ever since.
      </p>
      {siteNote && (
        <p>
          This site is itself a small engine: the{' '}
          <Link to="/">landing page</Link> renders a 3D "time machine" of my
          career with WebGL2 (or WebGPU), where each planet is a place I've
          worked and each glowing point opens a story. I made this site
          agentically (aka vibe coded) to see what the latest frontier models
          were capable of in 3D. The planets are procedural (no pre-baked
          textures) and the models are generated with AI.
        </p>
      )}
    </>
  );
}
