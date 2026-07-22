// React CSV import preview. File selection and persistence stay behind injected app adapters.

import React from 'react';
import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';

function Icon({ name, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded${className ? ` ${className}` : ''}`}
    >
      {name}
    </span>
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function StatCard({ label, value, subtitle, icon, tone }) {
  return (
    <article className={`finance-stat-card ${tone || ''}`}>
      <div className="finance-stat-copy">
        <label>{label}</label>
        <b>{value}</b>
        <span>{subtitle || ''}</span>
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
        <span
          key={`${issue.copy || 'issue'}-${index}`}
          className={`tag ${issue.tone || 'status-warn'}`}
        >
          {issue.copy}
        </span>
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
              <td>{row.sourceLineNumber || ''}</td>
              <td>
                <span className={`tag ${row.statusTone || 'status-warn'}`}>
                  {row.statusLabel || 'Needs Review'}
                </span>
              </td>
              <td>{row.date || ''}</td>
              <td>{row.description || ''}</td>
              <td className="amount">{row.amount || ''}</td>
              <td>{row.account || ''}</td>
              <td>{row.category || ''}</td>
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
            <h3>{data.fileName || 'transactions.csv'}</h3>
            <p>{data.summaryCopy || '0 of 0 rows ready'}</p>
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
            <span key={item.field} className="tag">
              {item.copy}
            </span>
          ))}
        </div>
        {asArray(data.parseIssues).length ? (
          <div className="panel-note status-bad" style={{ marginTop: 12 }}>
            <IssueTags issues={data.parseIssues} />
          </div>
        ) : null}
        {data.resultMessage ? (
          <div className="panel-note status-good" style={{ marginTop: 12 }}>
            {data.resultMessage}
          </div>
        ) : null}
        {data.errorMessage ? (
          <div className="panel-note status-bad" role="alert" style={{ marginTop: 12 }}>
            {data.errorMessage}
          </div>
        ) : null}
        <div className="reference-card-title" style={{ marginTop: 14 }}>
          <h3>Rejected Row Report</h3>
          <span className="tag">{String(data.reviewRowCount || 0)} rows</span>
        </div>
        <ImportRows rows={data.rows} />
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" {...actions.action(actionName)}>
            {actionLabel}
          </button>
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
