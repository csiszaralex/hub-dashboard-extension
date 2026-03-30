import React from 'react';
import ReactDOM from 'react-dom/client';
import '../i18n/i18n';
import { Popup } from './Popup';
import '../index.css';

ReactDOM.createRoot(document.getElementById('popup-root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
