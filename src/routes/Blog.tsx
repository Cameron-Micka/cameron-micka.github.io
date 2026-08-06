import { TopNav } from '@/ui/TopNav';
import { UI } from '@/ui/strings';

export default function Blog() {
  return (
    <>
      <TopNav solid />
      <article className="page">
        <h1>Blog</h1>
        <p className="lede">{UI.blogSoon}</p>
        <p>
          I plan to write about real-time rendering, shader craft, and the
          engineering behind this site. Subscribe via the social links on the{' '}
          <a href="/contact">contact page</a>.
        </p>
      </article>
    </>
  );
}
