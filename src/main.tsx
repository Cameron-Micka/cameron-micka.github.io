import { ViteReactSSG } from 'vite-react-ssg';
import './ui/styles.css';
import { routes } from './routes';
import { applyCrt, applyTheme, loadSettings } from './settings';

// Applied before first paint so the overlay never flashes on a reload.
const initialSettings = loadSettings();
applyCrt(initialSettings.crt);
applyTheme(initialSettings.theme);

export const createRoot = ViteReactSSG({ routes });
