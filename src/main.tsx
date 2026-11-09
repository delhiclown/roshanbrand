import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const registerServiceWorker = async () => {
      try {
        await navigator.serviceWorker.register('/service-worker.js');
      } catch (error) {
        console.error('Failed to register the service worker:', error);
      }
    };
    void registerServiceWorker();
  });
}

createRoot(document.getElementById('root')!).render(<App />);
