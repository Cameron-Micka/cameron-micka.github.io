import { ViteReactSSG } from 'vite-react-ssg';
import './ui/styles.css';
import { routes } from './routes';
import { applyCrt, loadSettings } from './settings';

// Applied before first paint so the overlay never flashes on a reload.
applyCrt(loadSettings().crt);

export const createRoot = ViteReactSSG({ routes });
