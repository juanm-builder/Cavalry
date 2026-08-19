import { useEffect } from 'react';

import { advisorServerStatePatch, loadAdvisorRuntimeState } from './advisor-application-adapter.js';

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function useAdvisorRuntimeState(advisor, setSettingsViewState) {
  useEffect(() => {
    let active = true;
    let serverRevision = 0;
    const refreshServerStatus = async () => {
      const revision = ++serverRevision;
      try {
        const result = await advisor.invoke('getServerStatus');
        if (!active || revision !== serverRevision) return;
        if (!result || result.ok === false) return;
        const status = asObject(result && (result.status || result));
        setSettingsViewState((current) => ({
          ...current,
          ...advisorServerStatePatch(
            asObject(current.advisorSettings),
            status,
            asObject(current.advisorOperation)
          )
        }));
      } catch (_error) {
        // The active operation reconciles failures in its own finally path.
      }
    };
    const unsubscribe =
      typeof advisor.subscribe === 'function'
        ? advisor.subscribe(() => {
            void refreshServerStatus();
          })
        : () => {};
    const initialServerRevision = ++serverRevision;
    loadAdvisorRuntimeState(advisor).then((runtimeState) => {
      if (!active) return;
      setSettingsViewState((current) => ({
        ...current,
        advisorSettings: {
          ...asObject(current.advisorSettings),
          ...asObject(runtimeState.advisorSettings)
        },
        ...(initialServerRevision === serverRevision
          ? {
              advisorServerStatus: runtimeState.advisorServerStatus,
              advisorServerToggleState: runtimeState.advisorServerToggleState,
              advisorServerDetail: runtimeState.advisorServerDetail
            }
          : {}),
        advisorMicrophone: runtimeState.advisorMicrophone
      }));
    });
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [advisor, setSettingsViewState]);
}
