import React from 'react';

import { AppShell } from './app/AppShell.jsx';
import { DEFAULT_ROUTE_ID, getRouteById } from './app/routes.js';

export function App({
  routeId = DEFAULT_ROUTE_ID,
  routeModels = {},
  ports,
  autoHydrate = true,
  onAction
}) {
  return (
    <AppShell
      routeId={getRouteById(routeId).id}
      routeModels={routeModels}
      ports={ports}
      autoHydrate={autoHydrate}
      onAction={onAction}
    />
  );
}
