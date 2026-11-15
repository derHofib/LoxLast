import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Schrift selbst gehostet (über das Bundle), nicht von Google geladen (Kap. 12)
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@lastplan/ui/tokens.css';
import '@lastplan/ui/ui.css';
import './global.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Element #root fehlt in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
