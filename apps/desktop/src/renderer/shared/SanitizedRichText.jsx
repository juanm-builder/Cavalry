import React from 'react';

const ALLOWED_TAGS = new Set([
  'a',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'code',
  'col',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'label',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul'
]);

const VOID_TAGS = new Set(['br', 'col', 'hr', 'img', 'input']);
const BOOLEAN_ATTRIBUTES = new Set([
  'checked',
  'disabled',
  'hidden',
  'multiple',
  'open',
  'readonly',
  'required',
  'selected'
]);
const ALLOWED_ATTRIBUTES = new Set([
  'accept',
  'action',
  'alt',
  'autocomplete',
  'class',
  'colspan',
  'for',
  'height',
  'href',
  'id',
  'max',
  'maxlength',
  'method',
  'min',
  'minlength',
  'name',
  'placeholder',
  'rel',
  'role',
  'rowspan',
  'src',
  'step',
  'style',
  'tabindex',
  'target',
  'title',
  'type',
  'value',
  'width'
]);
const ATTRIBUTE_NAMES = Object.freeze({
  class: 'className',
  for: 'htmlFor',
  readonly: 'readOnly',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  minlength: 'minLength',
  autocomplete: 'autoComplete'
});

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function sanitizeUrl(value, attribute) {
  const url = decodeEntities(value).trim();
  if (!url) return '';
  if (attribute === 'src' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url;
  if (/^(?:https?:|mailto:|#|\/)/i.test(url)) return url;
  return '';
}

function cssPropertyName(value) {
  if (value.startsWith('--')) return value;
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function sanitizeStyle(value) {
  const style = {};
  decodeEntities(value)
    .split(';')
    .forEach((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 1) return;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (!/^--[a-z0-9_-]+$|^[a-z][a-z0-9-]*$/i.test(property)) return;
      if (!propertyValue || /(?:url\s*\(|expression\s*\(|javascript:|@import)/i.test(propertyValue))
        return;
      style[cssPropertyName(property)] = propertyValue;
    });
  return style;
}

function parseAttributes(source) {
  const props = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(source);
  while (match) {
    const rawName = match[1].toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
    const isExtended = rawName.startsWith('data-') || rawName.startsWith('aria-');
    if (
      !rawName.startsWith('on') &&
      (isExtended || ALLOWED_ATTRIBUTES.has(rawName) || BOOLEAN_ATTRIBUTES.has(rawName))
    ) {
      const name = ATTRIBUTE_NAMES[rawName] || rawName;
      if (BOOLEAN_ATTRIBUTES.has(rawName)) {
        props[name] = true;
      } else if (rawName === 'style') {
        const style = sanitizeStyle(rawValue);
        if (Object.keys(style).length) props.style = style;
      } else if (rawName === 'href' || rawName === 'src') {
        const url = sanitizeUrl(rawValue, rawName);
        if (url) props[name] = url;
      } else if (rawName === 'value') {
        props.defaultValue = decodeEntities(rawValue);
      } else {
        props[name] = decodeEntities(rawValue);
      }
    }
    match = pattern.exec(source);
  }
  if (props.target === '_blank') props.rel = 'noopener noreferrer';
  return props;
}

function stripBlockedElements(html) {
  let output = String(html || '');
  const blocked =
    /<(script|style|iframe|object|embed|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  let previous = '';
  while (previous !== output) {
    previous = output;
    output = output.replace(blocked, '');
  }
  return output.replace(/<\/?(?:script|style|iframe|object|embed|svg|math|template)\b[^>]*>/gi, '');
}

export function parseSanitizedHtml(html) {
  const root = { children: [] };
  const stack = [root];
  const source = stripBlockedElements(html);
  const tokens = source.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g) || [];

  tokens.forEach((token) => {
    if (token.startsWith('<!--')) return;
    if (!token.startsWith('<') || token === '<') {
      stack.at(-1).children.push(decodeEntities(token));
      return;
    }
    const closing = /^<\//.test(token);
    const tagMatch = /^<\/?\s*([A-Za-z0-9-]+)/.exec(token);
    if (!tagMatch) return;
    const tag = tagMatch[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return;
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      return;
    }
    const attributeSource = token.slice(
      tagMatch[0].length,
      token.length - (token.endsWith('/>') ? 2 : 1)
    );
    const node = { tag, props: parseAttributes(attributeSource), children: [] };
    stack.at(-1).children.push(node);
    if (!VOID_TAGS.has(tag) && !token.endsWith('/>')) stack.push(node);
  });

  function toReactNode(node, key) {
    if (typeof node === 'string') return node;
    const children = node.children.map((child, index) => toReactNode(child, `${key}-${index}`));
    return React.createElement(node.tag, { ...node.props, key }, ...children);
  }

  return root.children.map((node, index) => toReactNode(node, `safe-html-${index}`));
}

export function SanitizedRichText({ html, as: Root = 'div', ...props }) {
  return <Root {...props}>{parseSanitizedHtml(html)}</Root>;
}
