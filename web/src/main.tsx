import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import './ui/kit.css';
import './ui/layout.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
