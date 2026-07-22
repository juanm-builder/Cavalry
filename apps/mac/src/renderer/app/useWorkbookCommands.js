// Keeps command-result application separate from route components.

import { useCommandExecutor } from './CommandExecutor.jsx';

export function useWorkbookCommands() {
  const { executeCommandResult } = useCommandExecutor();
  return {
    applyCommandResult: executeCommandResult
  };
}
