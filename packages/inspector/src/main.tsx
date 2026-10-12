import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { isReplay } from './lib/connection.ts';
import './styles/global.css';

// A replay is framed in a page that owns the theme: follow its stored choice as it changes.
if (isReplay) {
  window.addEventListener('storage', ({ key, newValue }) => {
    if (key === 'gut:theme' && (newValue === 'light' || newValue === 'dark')) {
      document.documentElement.dataset.theme = newValue;
    }
  });
}

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
