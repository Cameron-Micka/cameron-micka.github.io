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
          I plan to write about engineering, real-time rendering, bridging
          design to code and other nonsense on this site. For now please stay in
          touch via the social links on the <a href="/contact">contact page</a>.
        </p>
      </article>
    </>
  );
}
