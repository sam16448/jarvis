import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { App } from './ui/App';
import { init } from './store/store';
import { unlockOnFirstGesture } from './voice/speak';
import { registerSW } from 'virtual:pwa-register';

// Check for a new version on launch and whenever the app comes back to the foreground;
// a new version installs and the page reloads itself (data is untouched).
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void reg.update(); });
    setInterval(() => void reg.update(), 60 * 60 * 1000);
  },
});

init();
unlockOnFirstGesture();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
