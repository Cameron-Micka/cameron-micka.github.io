import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from './strings';

type OpenStory = (company: string, poi: string) => void;

// Inline link to a timeline story. Without onOpen it navigates to the story's
// deep link; inside the story dialog onOpen scrolls the feed in place.
function StoryRef({
  company,
  poi,
  onOpen,
  children,
}: {
  company: string;
  poi: string;
  onOpen?: OpenStory;
  children: ReactNode;
}) {
  return (
    <Link
      className="story-ref"
      to={`/#/${company}/${poi}`}
      onClick={
        onOpen
          ? (event) => {
              event.preventDefault();
              onOpen(company, poi);
            }
          : undefined
      }
    >
      {children}
    </Link>
  );
}

// The opening About paragraphs, shared by the About page and the top of the
// story dialog. The dialog already sits on the 3D landing page, so it omits the
// closing note about how this site was built.
export function AboutIntro({
  siteNote = true,
  onOpenStory,
}: {
  siteNote?: boolean;
  onOpenStory?: OpenStory;
}) {
  const ref = (company: string, poi: string, children: ReactNode) => (
    <StoryRef company={company} poi={poi} onOpen={onOpenStory}>
      {children}
    </StoryRef>
  );
  return (
    <>
      <p>
        I'm {SITE.name}, a {SITE.role.toLowerCase()} who takes pride in handing
        other creative people superpowers. Fifteen-plus years, a drawer full of
        shipped titles, and a love for simulations, renderers, gameplay and AI
        systems, physics, and the design tools that turn "what if" into "ship
        it." My work spans{' '}
        {ref('microsoft', 'hololens-2-isvs', 'mixed reality')} at Microsoft and
        console game development at studios like Fun Bits Interactive and
        LucasArts, all rooted in a real-time interactive simulation education at{' '}
        {ref('digipen', 'student-games', 'DigiPen')}.
      </p>
      <p>
        It started with{' '}
        {ref(
          'micka-studios',
          'hairball',
          'one of the very first games submitted to the iTunes App Store',
        )}{' '}
        — a scrappy app Microsoft liked enough to buy for the{' '}
        {ref('micka-studios', 'hairball-zune-hd', 'Zune HD')}. That got me a
        seat at LucasArts as a gameplay engineer on the{' '}
        {ref(
          'lucasarts',
          'force-unleashed-ii',
          'Star Wars: The Force Unleashed series',
        )}{' '}
        for Xbox 360 and PlayStation 3, where I learned that lightsabers are
        mostly physics problems wearing a great costume.
      </p>
      <p>
        Next came Fun Bits Interactive and{' '}
        {ref('fun-bits', 'escape-plan', 'Escape Plan')}, a bestselling
        PlayStation Vita title built on a custom port of Unity. I was promoted
        to Technical Director and led a team of 12 engineers through{' '}
        {ref('fun-bits', 'fat-princess-adventures', 'Fat Princess Adventures')},
        a cooperative online multiplayer RPG — while building a bespoke
        PlayStation 4 engine underneath it. In 2016 I joined Microsoft, where
        I've focused on mixed reality and{' '}
        {ref(
          'microsoft',
          'graphics-tools-unity',
          'bridging the gap between design and engineering',
        )}{' '}
        ever since.
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
