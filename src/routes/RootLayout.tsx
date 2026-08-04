import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  );
}
