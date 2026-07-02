import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProfileProvider } from './context/ProfileContext.jsx';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProfileProvider>
      <App />
    </ProfileProvider>
  </React.StrictMode>
);