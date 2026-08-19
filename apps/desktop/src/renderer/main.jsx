import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.jsx';
import { createDesktopRendererPorts } from './platform/desktop-ports.js';
import { createTauriBridge } from './platform/tauri-bridge.js';

const root = document.getElementById('app');

if (root) {
  const bridge = createTauriBridge();
  createRoot(root).render(<App ports={createDesktopRendererPorts(bridge)} />);
}
