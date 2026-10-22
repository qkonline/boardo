import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { trackKeyboard } from './lib/viewport';

trackKeyboard();

const app = mount(App, { target: document.getElementById('app')! });

// Offline support: the service worker caches the app shell so Boardo opens without a network.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}

export default app;
