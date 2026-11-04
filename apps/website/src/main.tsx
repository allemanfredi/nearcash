import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (bundled by Vite): no requests to font CDNs.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles.css';

import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('index.html must contain <div id="root">');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
