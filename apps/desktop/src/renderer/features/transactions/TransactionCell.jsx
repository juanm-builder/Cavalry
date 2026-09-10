import React from 'react';
import { PrivateValue } from '../../shared/PrivateValue.jsx';

export function TransactionCell({ cell }) {
  const data = cell && typeof cell === 'object' ? cell : {};
  const className = data.className || 'transaction-cell';
  if (data.kind === 'entity') {
    return (
      <td className={className}>
        <div className="entity-cell inline-entity-cell transaction-entity-cell">
          <span>
            <PrivateValue as="strong">{data.value || ''}</PrivateValue>
            <PrivateValue as="small" className="transaction-origin-line">
              {data.subtitle || ''}
              {data.isAiOrigin ? (
                <span
                  aria-label="Added by Cavalry"
                  className="transaction-origin-emoji"
                  role="img"
                  title="Added by Cavalry"
                >
                  ✨
                </span>
              ) : null}
            </PrivateValue>
          </span>
        </div>
      </td>
    );
  }
  if (data.kind === 'category') {
    return (
      <PrivateValue as="td" className={className}>
        <span className={`category-dot ${data.tone || 'info'}`} />
        {data.value || 'Uncategorized'}
      </PrivateValue>
    );
  }
  if (data.kind === 'status') {
    return (
      <td className={className}>
        <PrivateValue as="span" className={`status-pill ${data.tone || 'info'}`}>
          {data.value || 'Transaction'}
        </PrivateValue>
      </td>
    );
  }
  return (
    <PrivateValue as="td" amount={data.kind === 'amount'} className={className}>
      {data.value || ''}
    </PrivateValue>
  );
}
