import React from 'react';
import { config } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { FONT_AWESOME_CATEGORY_ICON_NAMES, FONT_AWESOME_ICONS } from './fontawesome-icon-map.js';

// Cavalry owns the small amount of SVG sizing CSS it needs. Prevent the core
// package from injecting a runtime <style> tag into the desktop WebView document.
config.autoAddCss = false;

/*
 * Cavalry's icon compatibility layer.
 *
 * Product and workbook data still use stable semantic names such as
 * `receipt_long` and `local_cafe`. Those names resolve here to Font Awesome's
 * locally bundled SVG definitions, so no icon font, CDN, ligature text, or
 * network request is involved at runtime.
 */

const CATEGORY_ICON_NAMES = new Set(FONT_AWESOME_CATEGORY_ICON_NAMES);
const FALLBACK_ICON = FONT_AWESOME_ICONS.category;

export function hasCavalryIcon(name) {
  return Object.prototype.hasOwnProperty.call(FONT_AWESOME_ICONS, String(name || ''));
}

export const CAVALRY_ICON_NAMES = Object.freeze(Object.keys(FONT_AWESOME_ICONS));

export function CavalryIcon({ name, className = '', title = '', ...props }) {
  const iconName = String(name || 'category');
  const classes = `cavalry-glyph${className ? ` ${className}` : ''}`;
  const accessibleProps = title
    ? { 'aria-label': title, role: 'img', title }
    : { 'aria-hidden': 'true' };

  return (
    <FontAwesomeIcon
      {...props}
      {...accessibleProps}
      className={classes}
      data-cavalry-family={CATEGORY_ICON_NAMES.has(iconName) ? 'category' : 'utility'}
      data-cavalry-icon={iconName}
      data-icon-source="font-awesome"
      focusable="false"
      icon={FONT_AWESOME_ICONS[iconName] || FALLBACK_ICON}
    />
  );
}

export default CavalryIcon;
