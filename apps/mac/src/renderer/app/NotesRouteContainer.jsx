import React, { useMemo } from 'react';

import { NotesRoute } from '../features/notes/NotesRoute.jsx';
import { useCommandExecutor } from './CommandExecutor.jsx';
import { useWorkbookSession } from './WorkbookProvider.jsx';

export function NotesRouteContainer({ onAction }) {
  const { state, ports } = useWorkbookSession();
  const { executeCommandResult } = useCommandExecutor();
  const services = useMemo(
    () => ({
      createId: ports.ids.create,
      now: ports.clock.now,
      today: ports.clock.today,
      defaultDate: ports.clock.today,
      transactionBuilderServices: {
        createId: ports.ids.create
      }
    }),
    [ports.clock.now, ports.clock.today, ports.ids.create]
  );

  return (
    <NotesRoute
      advisor={ports.advisor}
      key={state.workbook?.id || 'notes'}
      onAction={onAction}
      onCommandResult={executeCommandResult}
      services={services}
      workbook={state.workbook || {}}
    />
  );
}
