import { ViteReactSSG } from 'vite-react-ssg';
import './ui/styles.css';
import { routes } from './routes';
import { installErrorCapture } from './ui/errorLog';

// Installed at module scope so failures during app bootstrap are captured too.
installErrorCapture();

export const createRoot = ViteReactSSG({ routes });
