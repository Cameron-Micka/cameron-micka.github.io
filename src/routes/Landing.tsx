import { lazy, Suspense } from 'react';
import { ClientOnly } from 'vite-react-ssg';
import { companies } from '@/content/companies';
import { PortfolioFallback } from '@/ui/ResumeContent';

const Experience = lazy(() =>
  import('@/ui/Experience').then((module) => ({ default: module.Experience })),
);

export default function Landing() {
  return (
    <ClientOnly fallback={<PortfolioFallback companies={companies} />}>
      {() => (
        <Suspense fallback={<PortfolioFallback companies={companies} />}>
          <Experience companies={companies} />
        </Suspense>
      )}
    </ClientOnly>
  );
}
