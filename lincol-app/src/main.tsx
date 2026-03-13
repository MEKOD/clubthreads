const LAZY_PRELOAD_RELOAD_KEY = 'lincol-preload-reload';

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();

  try {
    const hasRetried = window.sessionStorage.getItem(LAZY_PRELOAD_RELOAD_KEY) === '1';

    if (hasRetried) {
      window.sessionStorage.removeItem(LAZY_PRELOAD_RELOAD_KEY);
      return;
    }

    window.sessionStorage.setItem(LAZY_PRELOAD_RELOAD_KEY, '1');
  } catch {
    // Ignore session storage failures and still attempt a hard reload.
  }

  window.location.reload();
});

try {
  window.sessionStorage.removeItem(LAZY_PRELOAD_RELOAD_KEY);
} catch {
  // Ignore session storage failures during boot.
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
