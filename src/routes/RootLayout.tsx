import { ClientOnly } from 'vite-react-ssg';
import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ErrorConsole } from '@/ui/ErrorConsole';

export default function RootLayout() {
  return (
    <>
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <ClientOnly>{() => <ErrorConsole />}</ClientOnly>
    </>
  );
}
