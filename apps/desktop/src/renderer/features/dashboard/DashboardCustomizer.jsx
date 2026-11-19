import React, { useState } from 'react';
import { createPortal } from 'react-dom';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';
import { useActionBindings } from '../../shared/action-binding.jsx';
import { useModalDismiss } from '../../shared/use-modal-dismiss.js';
import { normalizeDashboardLayout } from './dashboard-route-model.js';

const DASHBOARD_SECTION_LABELS = {
  command: 'Net worth and cash flow',
  flows: 'Cash-flow timeline and spending by category',
  money_shape: 'Assets and obligations'
};

export function DashboardCustomizer({ layout }) {
  const { dispatch } = useActionBindings();
  const [draft, setDraft] = useState(() => normalizeDashboardLayout(layout));
  const close = () => dispatch('close-dashboard-customizer');
  const dismiss = useModalDismiss(close);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={dismiss}>
      <section
        className="modal-card dashboard-customizer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-customizer-heading"
      >
        <div className="panel-header">
          <h2 id="dashboard-customizer-heading">Customize dashboard</h2>
          <button
            className="btn btn-icon"
            type="button"
            aria-label="Close dashboard settings"
            onClick={close}
          >
            <CavalryIcon name="close" />
          </button>
        </div>
        <fieldset className="dashboard-section-choices">
          <legend>Visible sections</legend>
          {draft.map(({ id, visible }) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setDraft((current) =>
                    current.map((item) => (item.id === id ? { ...item, visible: checked } : item))
                  );
                }}
              />
              {DASHBOARD_SECTION_LABELS[id]}
            </label>
          ))}
        </fieldset>
        <div className="modal-actions">
          <button
            className="btn"
            type="button"
            onClick={() => setDraft(normalizeDashboardLayout([]))}
          >
            Reset defaults
          </button>
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => dispatch('apply-dashboard-layout', { layout: draft })}
          >
            Apply
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
