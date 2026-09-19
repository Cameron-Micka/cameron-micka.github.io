import { Link } from 'react-router-dom';
import { TopNav } from '@/ui/TopNav';

export default function NotFound() {
  return (
    <>
      <TopNav solid />
      <main id="main-content" className="page" tabIndex={-1}>
        <h1>404</h1>
        <p className="lede">This page drifted out of orbit.</p>
        <p>
          <Link className="action-link primary" to="/">
            Return to the timeline →
          </Link>
        </p>
      </main>
    </>
  );
}
