// Menus are portaled to the document, so their fixed positions must fit the
// visible viewport even when their trigger is in a narrow panel or dialog.
export function selectMenuPosition(rect) {
  const padding = 12;
  const gap = 7;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const width = Math.min(Math.max(rect.width, 240), Math.max(0, viewportWidth - padding * 2));
  const left = Math.max(padding, Math.min(rect.left, viewportWidth - padding - width));
  const below = Math.max(padding, rect.bottom + gap);
  const above = Math.max(padding, viewportHeight - rect.top + gap);
  const spaceBelow = viewportHeight - padding - below;
  const spaceAbove = viewportHeight - padding - above;
  const openAbove = spaceBelow < 240 && spaceAbove > spaceBelow;

  return {
    left: `${left}px`,
    top: openAbove ? 'auto' : `${below}px`,
    bottom: openAbove ? `${above}px` : 'auto',
    width: `${width}px`,
    maxHeight: `${Math.max(0, Math.min(420, openAbove ? spaceAbove : spaceBelow))}px`
  };
}
