import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { createElectronRendererPorts } from './platform/electron-ports.js';

const root = document.getElementById('app');

if (root) {
  createRoot(root).render(<App ports={createElectronRendererPorts()} />);
}
