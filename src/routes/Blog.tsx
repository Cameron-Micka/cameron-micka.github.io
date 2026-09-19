import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/ui/TopNav';
import { SOCIAL, UI } from '@/ui/strings';

export default function Blog() {
  return (
    <>
      <TopNav solid />
      <main id="main-content" className="page" tabIndex={-1}>
        <p className="eyebrow">Field notes / Coming soon</p>
        <h1>Blog</h1>
        <p className="lede">{UI.blogSoon}</p>
        <p>
          A space for the things learned while building: real-time graphics,
          creative tools, and closing the gap between a design and a shipped
          experience. The first essays are still taking shape.
        </p>
        <p>In the meantime, the work speaks for itself.</p>
        <div className="page-actions">
          <Link className="action-link primary" to="/">
            Explore the timeline <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <a
            className="action-link"
            href={SOCIAL.github}
            target="_blank"
            rel="noopener noreferrer"
          >
            Follow on GitHub <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
        <img
          className="golden-record"
          src="/golden-record-blog.svg"
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
