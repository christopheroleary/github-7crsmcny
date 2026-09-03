import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProfileProvider } from './context/ProfileContext.jsx';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { registerServiceWorker } from './utils/serviceWorker.js';
import { sweepExpiredOfflineTracks } from './utils/offlineBackingTracks.js';
import './index.css';

registerServiceWorker();
sweepExpiredOfflineTracks();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ProfileProvider>
        <App />
      </ProfileProvider>
    </ErrorBoundary>
  </React.StrictMode>
);