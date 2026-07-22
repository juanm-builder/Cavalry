import { useRef, useState } from 'react';

export const PANEL_DEFAULT_WIDTH = 430;
export const PANEL_RESIZE_STEP = 24;
export const PANEL_WIDTH_STORAGE_KEY = 'cavalry.assistant.panel-width';

const PANEL_MAX_WIDTH = 1100;
const PANEL_VIEWPORT_GUTTER = 240;

function panelMaxWidth() {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : PANEL_DEFAULT_WIDTH;
  return Math.max(PANEL_DEFAULT_WIDTH, Math.min(PANEL_MAX_WIDTH, viewport - PANEL_VIEWPORT_GUTTER));
}

function clampPanelWidth(value) {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.min(Math.max(width, PANEL_DEFAULT_WIDTH), panelMaxWidth());
}

function panelPreferenceStorage(preferred) {
  if (preferred) return preferred;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
}

function loadStoredPanelWidth(storage) {
  try {
    return clampPanelWidth(storage?.getItem(PANEL_WIDTH_STORAGE_KEY));
  } catch (_error) {
    return PANEL_DEFAULT_WIDTH;
  }
}

export function useCavalryAssistantPanelResize(preferredStorage) {
  const preferenceStorage = panelPreferenceStorage(preferredStorage);
  const [panelWidth, setPanelWidth] = useState(() => loadStoredPanelWidth(preferenceStorage));
  const [resizingPanel, setResizingPanel] = useState(false);
  const panelResizeRef = useRef(null);

  function applyPanelWidth(value) {
    const width = clampPanelWidth(value);
    setPanelWidth(width);
    try {
      preferenceStorage?.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
    } catch (_error) {
      // Width preference is best-effort; resizing still works for the session.
    }
    return width;
  }

  function beginPanelResize(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    panelResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingPanel(true);
  }

  function movePanelResize(event) {
    const drag = panelResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPanelWidth(clampPanelWidth(drag.startWidth + (drag.startX - event.clientX)));
  }

  function endPanelResize(event) {
    const drag = panelResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelResizeRef.current = null;
    setResizingPanel(false);
    applyPanelWidth(drag.startWidth + (drag.startX - event.clientX));
  }

  function cancelPanelResize(event) {
    const drag = panelResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelResizeRef.current = null;
    setResizingPanel(false);
    applyPanelWidth(panelWidth);
  }

  function resizePanelWithKeyboard(event) {
    let next = null;
    if (event.key === 'ArrowLeft') next = panelWidth + PANEL_RESIZE_STEP;
    else if (event.key === 'ArrowRight') next = panelWidth - PANEL_RESIZE_STEP;
    else if (event.key === 'Home') next = PANEL_DEFAULT_WIDTH;
    else if (event.key === 'End') next = panelMaxWidth();
    if (next == null) return;
    event.preventDefault();
    applyPanelWidth(next);
  }

  return {
    applyPanelWidth,
    beginPanelResize,
    cancelPanelResize,
    endPanelResize,
    maxPanelWidth: panelMaxWidth(),
    movePanelResize,
    panelWidth,
    resizePanelWithKeyboard,
    resizingPanel
  };
}
