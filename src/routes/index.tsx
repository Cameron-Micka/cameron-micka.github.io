import type { RouteRecord } from 'vite-react-ssg';
import RootLayout from './RootLayout';
import Landing from './Landing';
import About from './About';
import Blog from './Blog';
import Photography from './Photography';
import NotFound from './NotFound';

export const routes: RouteRecord[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Landing, entry: 'src/routes/Landing.tsx' },
      { path: 'about', Component: About },
      { path: 'blog', Component: Blog },
      { path: 'photography', Component: Photography },
      { path: '*', Component: NotFound },
    ],
  },
];
