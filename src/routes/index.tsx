import type { RouteRecord } from 'vite-react-ssg';
import RootLayout from './RootLayout';
import Landing from './Landing';
import About from './About';
import Contact from './Contact';
import Blog from './Blog';
import NotFound from './NotFound';

export const routes: RouteRecord[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Landing, entry: 'src/routes/Landing.tsx' },
      { path: 'about', Component: About },
      { path: 'contact', Component: Contact },
      { path: 'blog', Component: Blog },
      { path: '*', Component: NotFound },
    ],
  },
];
