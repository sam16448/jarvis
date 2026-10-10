import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { App } from './ui/App';
import { init } from './store/store';

init();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
