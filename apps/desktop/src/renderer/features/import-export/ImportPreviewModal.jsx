import { PrivateValue } from '../../shared/PrivateValue.jsx';
// React CSV import preview. File selection and persistence stay behind injected app adapters.

import React from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name, className = '' }) {
  return <CavalryIcon className={className} name={name} />;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function StatCard({ label, value, subtitle, icon, tone }) {
  return (
    <article className={`finance-stat-card ${tone || ''}`}>
      <div className="finance-stat-copy">
        <PrivateValue as="label">{label}</PrivateValue>
        <PrivateValue as="b">{value}</PrivateValue>
        <PrivateValue as="span">{subtitle || ''}</PrivateValue>
      </div>
      {icon ? <Icon className="finance-stat-icon" name={icon} /> : null}
    </article>
  );
}

function IssueTags({ issues }) {
  const rows = asArray(issues);
  if (!rows.length) {
    return null;
  }
  return (
    <>
      {rows.map((issue, index) => (
        <PrivateValue
          as="span"
          key={`${issue.copy || 'issue'}-${index}`}
          className={`tag ${issue.tone || 'status-warn'}`}
        >
          {issue.copy}
        </PrivateValue>
      ))}
    </>
  );
}

function ImportRows({ rows }) {
  const data = asArray(rows);
  if (!data.length) {
    return (
      <div className="empty-state compact-empty">
        <strong>No rows to review.</strong>
      </div>
    );
  }
  return (
    <div className="table-shell finance-table-shell csv-import-table">
      <table>
        <thead>
          <tr>
            <th>Line</th>
            <th>Status</th>
            <th>Date</th>
            <th>Description</th>
            <th className="amount">Amount</th>
            <th>Account</th>
            <th>Category</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id || row.sourceLineNumber}>
              <PrivateValue as="td">{row.sourceLineNumber || ''}</PrivateValue>
              <td>
                <PrivateValue as="span" className={`tag ${row.statusTone || 'status-warn'}`}>
                  {row.statusLabel || 'Needs Review'}
                </PrivateValue>
              </td>
              <PrivateValue as="td">{row.date || ''}</PrivateValue>
              <PrivateValue as="td">{row.description || ''}</PrivateValue>
              <PrivateValue as="td" className="amount">
                {row.amount || ''}
              </PrivateValue>
              <PrivateValue as="td">{row.account || ''}</PrivateValue>
              <PrivateValue as="td">{row.category || ''}</PrivateValue>
              <td>
                <IssueTags issues={row.issues} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportPreviewModalView({ model }) {
  const data = model || {};
  const actions = useActionBindings();
  const actionLabel = data.result ? 'Close' : 'Cancel';
  const actionName = data.result ? 'close-modal' : 'cancel-csv-import-preview';
  const dismissAction = actions.action(actionName);
  const dismiss = useModalDismiss(dismissAction.onClick);

  return (
    <div className="modal-backdrop" data-react-modal="csv-import-preview" onMouseDown={dismiss}>
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-label="CSV import preview"
      >
        <div className="panel-header">
          <div>
            <div className="badge">
              <Icon name="table_view" />
              CSV Import Preview
            </div>
            <PrivateValue as="h3">{data.fileName || 'transactions.csv'}</PrivateValue>
            <PrivateValue as="p">{data.summaryCopy || '0 of 0 rows ready'}</PrivateValue>
          </div>
          <button
            className="btn btn-icon"
            type="button"
            {...actions.action('close-modal')}
            title="Close"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        <section className="summary-card-grid">
          {asArray(data.stats).map((card) => (
            <StatCard key={card.id || card.label} {...card} />
          ))}
        </section>
        <div className="panel-note csv-mapping-report" style={{ marginTop: 12 }}>
          {asArray(data.mapping).map((item) => (
            <PrivateValue as="span" key={item.field} className="tag">
              {item.copy}
            </PrivateValue>
          ))}
        </div>
        {asArray(data.parseIssues).length ? (
          <div className="panel-note status-bad" style={{ marginTop: 12 }}>
            <IssueTags issues={data.parseIssues} />
          </div>
        ) : null}
        {data.resultMessage ? (
          <PrivateValue as="div" className="panel-note status-good" style={{ marginTop: 12 }}>
            {data.resultMessage}
          </PrivateValue>
        ) : null}
        {data.errorMessage ? (
          <PrivateValue
            as="div"
            className="panel-note status-bad"
            role="alert"
            style={{ marginTop: 12 }}
          >
            {data.errorMessage}
          </PrivateValue>
        ) : null}
        <div className="reference-card-title" style={{ marginTop: 14 }}>
          <h3>Rejected Row Report</h3>
          <PrivateValue as="span" className="tag">
            {String(data.reviewRowCount || 0)} rows
          </PrivateValue>
        </div>
        <ImportRows rows={data.rows} />
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <PrivateValue as="button" className="btn" type="button" {...actions.action(actionName)}>
            {actionLabel}
          </PrivateValue>
          <button
            className="btn btn-primary"
            type="button"
            {...actions.action('apply-csv-import-preview')}
            disabled={!data.canApply}
          >
            <Icon name="upload_file" />
            Apply Ready Rows
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImportPreviewModal({ model, onAction }) {
  return (
    <ActionBindingProvider onAction={onAction}>
      <ImportPreviewModalView model={model} />
    </ActionBindingProvider>
  );
}
