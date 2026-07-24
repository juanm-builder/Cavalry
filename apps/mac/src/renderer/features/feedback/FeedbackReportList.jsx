import React, { useState } from 'react';

import { getRouteById } from '../../app/routes.js';
import { formatUiDateTime } from '../../shared/date-format.js';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function statusPresentation(value) {
  const status = String(value || '').toLowerCase();
  if (['resolved', 'closed'].includes(status)) {
    return { label: status === 'resolved' ? 'Resolved' : 'Closed', tone: 'good' };
  }
  if (['reviewing', 'in_review', 'triaged'].includes(status)) {
    return { label: 'Reviewing', tone: 'info' };
  }
  return { label: 'Received', tone: 'neutral' };
}

function attachmentSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ReportAttachment({ attachment, onDownload, report }) {
  const [state, setState] = useState({ dataUrl: '', error: '', pending: false });
  const load = async () => {
    if (state.pending) return;
    if (state.dataUrl) {
      setState({ dataUrl: '', error: '', pending: false });
      return;
    }
    setState({ dataUrl: '', error: '', pending: true });
    const result = await onDownload?.({
      attachmentId: attachment.id,
      reportId: report.id
    });
    if (!(result && result.ok && result.attachment?.dataUrl)) {
      setState({
        dataUrl: '',
        error: result?.error || 'The attached image could not be loaded.',
        pending: false
      });
      return;
    }
    setState({ dataUrl: result.attachment.dataUrl, error: '', pending: false });
  };

  return (
    <div className="feedback-report-attachment">
      <button className="btn" disabled={state.pending} onClick={load} type="button">
        <Icon name={state.dataUrl ? 'visibility_off' : 'image'} />
        {state.pending ? 'Loading…' : state.dataUrl ? 'Hide image' : 'View image'}
      </button>
      <span>
        {attachment.fileName}
        {attachmentSize(attachment.sizeBytes) ? ` · ${attachmentSize(attachment.sizeBytes)}` : ''}
      </span>
      {state.error ? <small role="alert">{state.error}</small> : null}
      {state.dataUrl ? (
        <img
          alt={`Attachment for ${report.kind === 'bug' ? 'bug report' : 'feedback'}`}
          src={state.dataUrl}
        />
      ) : null}
    </div>
  );
}

export function FeedbackReportList({ feedback = {}, onDownloadAttachment }) {
  const reports = Array.isArray(feedback.reports) ? feedback.reports : [];
  if (!feedback.loaded && feedback.pendingOperation === 'list') {
    return (
      <div className="feedback-report-empty" role="status">
        <Icon name="progress_activity" />
        <div>
          <strong>Loading your reports…</strong>
          <small>Checking Cavalry Cloud</small>
        </div>
      </div>
    );
  }
  if (feedback.reportsError) {
    return (
      <div className="feedback-report-empty" role="alert">
        <Icon name="cloud_off" />
        <div>
          <strong>Reports unavailable</strong>
          <small>{feedback.reportsError}</small>
        </div>
      </div>
    );
  }
  if (!reports.length) {
    return (
      <div className="feedback-report-empty">
        <Icon name="inbox" />
        <div>
          <strong>No reports yet</strong>
          <small>Reports sent from this or another signed-in device will appear here.</small>
        </div>
      </div>
    );
  }

  return (
    <ol aria-label="Your feedback reports" className="feedback-report-list">
      {reports.map((report) => {
        const status = statusPresentation(report.status);
        const routeId = String(report.context?.routeId || report.context?.route_id || '');
        const route = routeId ? getRouteById(routeId) : null;
        return (
          <li className="feedback-report-item" key={report.id}>
            <header>
              <span className={`feedback-report-kind ${report.kind}`}>
                <Icon name={report.kind === 'bug' ? 'bug_report' : 'lightbulb'} />
              </span>
              <div>
                <strong>{report.kind === 'bug' ? 'Bug report' : 'Feedback'}</strong>
                <small>
                  {formatUiDateTime(report.createdAt) || 'Submitted recently'}
                  {route ? ` · From ${route.label}` : ''}
                </small>
              </div>
              <span className={`settings-status-pill ${status.tone}`}>{status.label}</span>
            </header>
            <p>{report.description}</p>
            {report.attachment ? (
              <ReportAttachment
                attachment={report.attachment}
                onDownload={onDownloadAttachment}
                report={report}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
