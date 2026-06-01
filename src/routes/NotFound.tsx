import { Link } from 'react-router-dom';
import { TopNav } from '@/ui/TopNav';

export default function NotFound() {
  return (
    <>
      <TopNav />
      <article className="page">
        <h1>404</h1>
        <p className="lede">This page drifted out of orbit.</p>
        <p>
          <Link to="/">Return to the timeline →</Link>
        </p>
      </article>
    </>
  );
}
