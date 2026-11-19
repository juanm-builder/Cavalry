import { createPortal } from 'react-dom';

// Route entry animations can make a fixed backdrop relative to a long page.
// Mount overlays at the viewport while preserving their React context.
export function renderInBody(content) {
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
