import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Head } from 'vite-react-ssg';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { SITE, SOCIAL, UI } from '@/ui/strings';

const PAGES: Record<string, { title: string; description: string }> = {
  '/': {
    title: `${SITE.name} \u2014 ${SITE.role}`,
    description:
      "Games, mixed reality, and creative tools. Explore Cameron Micka's work at Microsoft, Fun Bits, and LucasArts through a hand-built 3D career timeline.",
  },
  '/about': {
    title: `About \u2014 ${SITE.name}`,
    description:
      'Meet Cameron Micka, a principal software engineer bridging design and engineering across mixed reality, games, and real-time graphics.',
  },
  '/blog': {
    title: `Writing \u2014 ${SITE.name}`,
    description:
      'Notes on real-time graphics, creative tools, and the craft of shipping. Writing by Cameron Micka.',
  },
  '/photography': {
    title: `Photography \u2014 ${SITE.name}`,
    description:
      'Nature and automotive photography by Cameron Micka. Frames from the road and the trail, shot for the love of light.',
  },
};

export default function RootLayout() {
  const { pathname, hash } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  const previousPath = useRef(pathname);
  const metadata = PAGES[path] ?? {
    title: `Page not found \u2014 ${SITE.name}`,
    description:
      "This page drifted out of orbit. Return to Cameron Micka's portfolio.",
  };

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }, [pathname, hash]);

  return (
    <ErrorBoundary>
      <Head>
        <title>{metadata.title}</title>
        <meta name="description" content={metadata.description} />
        <meta name="theme-color" content="#d2bea0" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE.name} />
        <meta property="og:title" content={metadata.title} />
        <meta property="og:description" content={metadata.description} />
        <meta property="og:url" content={`${SITE.url}${path}`} />
        <meta property="og:image" content={`${SITE.url}/og.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content="Cameron Micka: design meets real-time engineering."
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metadata.title} />
        <meta name="twitter:description" content={metadata.description} />
        <meta name="twitter:image" content={`${SITE.url}/og.png`} />
        {PAGES[path] ? (
          <link rel="canonical" href={`${SITE.url}${path}`} />
        ) : (
          <meta name="robots" content="noindex" />
        )}
      </Head>
      <a className="skip-link" href="#main-content">
        {UI.skip}
      </a>
      <Outlet />
      {path !== '/' && (
        <footer className="site-footer">
          <div>
            <Link to="/about#contact">Get in touch</Link>
            <a
              href={`${SOCIAL.github}/cameron-micka.github.io`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View source
            </a>
          </div>
        </footer>
      )}
    </ErrorBoundary>
  );
}
