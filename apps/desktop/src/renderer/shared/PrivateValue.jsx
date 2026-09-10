import React from 'react';
import { useAmountVisibility } from '../app/AmountVisibilityProvider.jsx';
import { HIDDEN_AMOUNT, maskFinancialText } from './amount-privacy.js';

function privateProps(props) {
  const result = { ...props };
  for (const key of ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'alt']) {
    if (typeof result[key] === 'string') {
      result[key] = maskFinancialText(result[key], 'Amount hidden');
    }
  }
  return result;
}

// Rich text may contain nested native elements. Redact their display and labels
// without changing link targets, event handlers, input values or component data.
function privateChildren(children) {
  const merged = [];
  React.Children.forEach(children, (child) => {
    const previous = merged.at(-1);
    if (
      (typeof child === 'string' || typeof child === 'number') &&
      (typeof previous === 'string' || typeof previous === 'number')
    ) {
      merged[merged.length - 1] = String(previous) + String(child);
    } else {
      merged.push(child);
    }
  });
  return React.Children.map(merged, (child) => {
    if (typeof child === 'string') return maskFinancialText(child);
    if (
      React.isValidElement(child) &&
      (typeof child.type === 'string' || child.type === React.Fragment)
    ) {
      const props = privateProps(child.props);
      if (child.props.children !== undefined)
        props.children = privateChildren(child.props.children);
      return React.cloneElement(child, props);
    }
    return child;
  });
}

/** Renders the original element; no blur, hidden raw text or extra DOM wrapper. */
export function PrivateValue({ as = 'span', amount = false, children, ...props }) {
  const { amountsHidden } = useAmountVisibility();
  if (!amountsHidden) return React.createElement(as, props, children);
  const maskedProps = privateProps(props);
  if (amount) {
    maskedProps['aria-label'] = 'Amount hidden';
    delete maskedProps['aria-valuenow'];
    delete maskedProps['aria-valuemin'];
    delete maskedProps['aria-valuemax'];
  }
  return React.createElement(as, maskedProps, amount ? HIDDEN_AMOUNT : privateChildren(children));
}
