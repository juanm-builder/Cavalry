import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ActionBindingProvider, useActionBindings } from '../../shared/action-binding.jsx';
import {
  ACCOUNT_ACTIONS,
  buildAccountsFeatureModel,
  executeAccountCommand
} from './account-controller.js';
import {
  AccountConfirmationModal,
  AccountCreateWizard,
  AccountCurrencyRepairModal
} from './AccountModals.jsx';
import { AccountEditModal } from './AccountEditModal.jsx';
import { AccountTransactionDetailModal } from './AccountTransactionDetailModal.jsx';
import { InstitutionMark } from '../../shared/InstitutionSelect.jsx';

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

function withClick(binding, callback) {
  const boundClick = binding?.onClick;
  return {
    ...(binding || {}),
    onClick(event) {
      boundClick?.(event);
      callback?.(event);
    }
  };
}

function PageHeader({ title, subtitle, children }) {
  return (
    <section className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      <div className="page-actions">{children}</div>
    </section>
  );
}

function StatCard({ label, value, subtitle, icon, tone, binding }) {
  const body = (
    <>
      <div className="finance-stat-copy">
        <label>{label}</label>
        <b>{value}</b>
        <span>{subtitle || ''}</span>
      </div>
      {icon ? <Icon className="finance-stat-icon" name={icon} /> : null}
    </>
  );
  const className = `finance-stat-card ${tone || ''}${binding ? ' finance-stat-action' : ''}`;
  return binding ? (
    <button className={className} type="button" {...binding}>
      {body}
    </button>
  ) : (
    <article className={className}>{body}</article>
  );
}

function AccountCollection({
  rows,
  view,
  actions,
  createBinding,
  onSelect,
  emptyCopy = 'No accounts yet.'
}) {
  return (
    <div
      className={view === 'grid' ? 'account-card-grid' : 'account-compact-list'}
      data-account-view={view}
      role="list"
    >
      <article className="account-create-slot" role="listitem">
        <button
          className={view === 'grid' ? 'account-create-card' : 'account-create-entry'}
          type="button"
          {...createBinding}
        >
          <Icon name="add" />
          <span>
            <strong>Create account</strong>
            <small>Add a new account to track balances and transactions</small>
          </span>
        </button>
      </article>
      {!rows.length ? (
        <div className="account-empty-register" role="listitem">
          <div className="empty-state compact-empty">
            <Icon name="account_balance" />
            <strong>{emptyCopy}</strong>
          </div>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const payload = { accountId: row.id };
        const accessibleLabel = [
          ...new Set(
            [
              `Open ${row.name} account`,
              row.typeLabel,
              row.institution,
              row.balanceCell?.copy ? `Balance ${row.balanceCell.copy}` : '',
              row.activityCopy,
              row.isArchived ? 'Archived' : '',
              `${index + 1} of ${rows.length}`
            ].filter(Boolean)
          )
        ].join(', ');
        return (
          <article
            className={`account-list-card${row.isArchived ? ' is-archived' : ''}${
              row.isSelected ? ' is-selected' : ''
            }`}
            data-account-id={row.id}
            key={row.id}
            role="listitem"
            style={row.institutionColor ? { '--account-brand': row.institutionColor } : undefined}
          >
            <button
              aria-current={row.isSelected ? 'true' : undefined}
              aria-label={accessibleLabel}
              className="account-list-card-main"
              type="button"
              {...withClick(actions.action('select-account', payload), () => onSelect(row.id))}
            >
              <InstitutionMark
                className={`mini-icon ${row.tone || 'info'}`}
                fallbackIcon={row.icon || 'account_balance'}
                institutionId={row.logoMode === 'icon' ? '' : row.institutionId}
              />
              <span className="account-list-card-copy">
                <strong>{row.name}</strong>
                <small>
                  {[row.institution, row.isArchived ? 'Archived' : ''].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="account-list-card-financial">
                <b className={`amount ${row.balanceCell?.tone || ''}`}>{row.balanceCell?.copy}</b>
                <small className={row.activityTone || 'info'}>{row.activityCopy}</small>
              </span>
              <Icon className="account-list-card-chevron" name="chevron_right" />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function AccountHistoryVisual({
  rows = [],
  emptyCopy = 'No account history yet.',
  onSelectTransaction
}) {
  const chartRows = rows.slice(0, 8).reverse();
  if (!chartRows.length) {
    return (
      <div className="account-history-visual empty">
        <div className="account-history-empty">
          <Icon name="timeline" />
          <strong>{emptyCopy}</strong>
        </div>
      </div>
    );
  }
  const width = 320;
  const height = 142;
  const padX = 18;
  const padY = 20;
  const balances = chartRows.map((row) => Number(row.runningBalance) || 0);
  const minBalance = Math.min(...balances, 0);
  const maxBalance = Math.max(...balances, 0);
  const spread = Math.max(1, maxBalance - minBalance);
  const zeroY = Math.max(
    padY,
    Math.min(height - padY, padY + (maxBalance / spread) * (height - padY * 2))
  );
  const points = chartRows.map((row, index) => ({
    row,
    x:
      chartRows.length === 1
        ? width / 2
        : padX + (width - padX * 2) * (index / (chartRows.length - 1)),
    y: padY + ((maxBalance - (Number(row.runningBalance) || 0)) / spread) * (height - padY * 2),
    tone: (Number(row.runningBalance) || 0) >= 0 ? 'good' : 'bad'
  }));
  const linePath = points
    .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)} ${zeroY.toFixed(1)} L${points[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  return (
    <div className="account-history-visual">
      <div className="account-history-plot">
        <svg
          aria-label="Recent account balance history"
          className="account-history-chart"
          focusable="false"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <path
            className="account-history-grid"
            d={`M${padX} ${padY}H${width - padX}M${padX} ${height / 2}H${width - padX}M${padX} ${height - padY}H${width - padX}`}
          />
          <path
            className="account-history-baseline"
            d={`M${padX} ${zeroY.toFixed(1)}H${width - padX}`}
          />
          <path className="account-history-area" d={areaPath} />
          <path className="account-history-line" d={linePath} />
          {points.map((point) => {
            const tooltipWidth = 146;
            const tooltipHeight = 70;
            const tooltipX = Math.max(
              4,
              Math.min(width - tooltipWidth - 4, point.x - tooltipWidth / 2)
            );
            const tooltipY =
              point.y < height / 2
                ? Math.min(height - tooltipHeight - 4, point.y + 13)
                : Math.max(4, point.y - tooltipHeight - 13);
            const description = point.row.description || 'Transaction';
            const shortDescription =
              description.length > 23 ? `${description.slice(0, 22)}…` : description;
            return (
              <g
                aria-label={`${point.row.date}: ${description}, ${point.row.changeCopy || 'change unavailable'}, balance ${point.row.balanceCopy}`}
                aria-haspopup="dialog"
                className="account-history-interactive-point"
                key={`${point.row.transactionId}-${point.x}`}
                onClick={(event) => onSelectTransaction?.(point.row, event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelectTransaction?.(point.row, event.currentTarget);
                }}
                role="button"
                tabIndex="0"
              >
                <circle
                  className="account-history-hit-area"
                  cx={point.x.toFixed(1)}
                  cy={point.y.toFixed(1)}
                  r="10"
                />
                <circle
                  className={`account-history-dot ${point.tone}`}
                  cx={point.x.toFixed(1)}
                  cy={point.y.toFixed(1)}
                  r="4.8"
                />
                <g
                  aria-hidden="true"
                  className="account-history-svg-tooltip"
                  transform={`translate(${tooltipX.toFixed(1)} ${tooltipY.toFixed(1)})`}
                >
                  <rect height={tooltipHeight} rx="8" width={tooltipWidth} />
                  <text className="account-history-svg-title" x="10" y="16">
                    {shortDescription}
                  </text>
                  <text className="account-history-svg-date" x="10" y="29">
                    {point.row.date}
                  </text>
                  <text className="account-history-svg-label" x="10" y="47">
                    Change
                  </text>
                  <text
                    className={`account-history-svg-value ${Number(point.row.change) >= 0 ? 'good' : 'bad'}`}
                    textAnchor="end"
                    x={tooltipWidth - 10}
                    y="47"
                  >
                    {point.row.changeCopy || '—'}
                  </text>
                  <text className="account-history-svg-label" x="10" y="62">
                    Balance
                  </text>
                  <text
                    className="account-history-svg-value"
                    textAnchor="end"
                    x={tooltipWidth - 10}
                    y="62"
                  >
                    {point.row.balanceCopy}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="account-history-summary">
        <span>{points[0].row.date || ''}</span>
        <strong>{points.at(-1).row.balanceCopy || ''}</strong>
        <span>{points.at(-1).row.date || ''}</span>
      </div>
    </div>
  );
}

function AccountDetailMenu({ selected, actions, onOpenModal }) {
  if (selected.isSystem) return null;
  return (
    <details className="account-detail-menu">
      <summary
        aria-label="More account options"
        className="btn btn-icon"
        title="More account options"
      >
        <Icon name="more_vert" />
      </summary>
      <div className="account-detail-menu-popover">
        <button
          className="account-detail-menu-item"
          type="button"
          {...withClick(
            actions.action(selected.isArchived ? 'restore-account' : 'archive-account', {
              accountId: selected.id
            }),
            () => onOpenModal(selected.isArchived ? 'restore' : 'archive', selected)
          )}
        >
          <Icon name={selected.isArchived ? 'unarchive' : 'archive'} />
          {selected.isArchived ? 'Restore Account' : 'Archive Account'}
        </button>
        <button
          className="account-detail-menu-item danger"
          type="button"
          {...withClick(actions.action('delete-account', { accountId: selected.id }), () =>
            onOpenModal('delete', selected)
          )}
        >
          <Icon name="delete" /> Delete Account
        </button>
      </div>
    </details>
  );
}

function AccountDetail({
  selected,
  historyBinding,
  editBinding,
  onEdit,
  actions,
  onOpenModal,
  onSelectTransaction
}) {
  if (!selected)
    return (
      <div className="empty-state compact-empty">
        <strong>Select or add an account.</strong>
      </div>
    );
  return (
    <>
      <div className="selected-account-hero">
        <span className={`selected-account-mark ${selected.tone || 'info'}`}>
          <InstitutionMark
            fallbackIcon={selected.icon || 'account_balance'}
            institutionId={selected.logoMode === 'icon' ? '' : selected.institutionId}
          />
        </span>
        <div className="selected-account-copy">
          <h3>{selected.name}</h3>
          <small>{selected.institution}</small>
        </div>
      </div>
      <div className="selected-account-balance">
        <b className={`amount ${selected.balanceTone || ''}`}>{selected.balanceCopy}</b>
        <span>{selected.balanceLabel || 'Current Balance'}</span>
      </div>
      {selected.hasCurrencyIntegrityIssue ? (
        <div className="panel-note status-bad account-currency-integrity" role="alert">
          <strong>Account currency needs review.</strong>
          <br />
          {selected.currencyIntegrityCopy}
          <br />
          <small>
            The book balance above is shown in {selected.balanceCurrency} so Cavalry does not
            silently revalue mixed historical postings.
          </small>
          {selected.canRepairCurrency ? (
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => onOpenModal('repair-currency', selected)}
                type="button"
              >
                <Icon name="verified_user" /> Review Safe Repair
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="selected-account-actions">
        <button className="btn account-primary-action" type="button" {...historyBinding}>
          <Icon name="receipt_long" /> View Transactions
        </button>
        {!selected.isSystem ? (
          <button className="btn" type="button" {...withClick(editBinding, onEdit)}>
            <Icon name="edit" /> Edit Account
          </button>
        ) : null}
        <AccountDetailMenu actions={actions} onOpenModal={onOpenModal} selected={selected} />
      </div>
      {selected.changeCopy ? (
        <div className={`selected-account-delta ${selected.changeTone || ''}`}>
          <span>{selected.changeCopy}</span>
          <small>{selected.changePercentCopy || selected.activityLabel}</small>
        </div>
      ) : null}
      <div className="reference-card-title account-subtitle-row">
        <h3>Balance History</h3>
        <span className="tag">{selected.asOfLabel}</span>
      </div>
      <AccountHistoryVisual
        onSelectTransaction={onSelectTransaction}
        rows={asArray(selected.historyRows)}
      />
      <div className="account-detail-grid">
        <span>Account Type</span>
        <b>{selected.typeLabel}</b>
        <span>Institution</span>
        <b>{selected.institutionName || '—'}</b>
        <span>Opened</span>
        <b>{selected.openedDate || 'Not set'}</b>
        <span>Currency</span>
        <b>{selected.currency}</b>
        {selected.hasCurrencyIntegrityIssue ? (
          <>
            <span>Ledger Postings</span>
            <b>{asArray(selected.postingCurrencies).join(', ') || 'Missing currency data'}</b>
          </>
        ) : null}
        <span>Status</span>
        <b>{selected.isArchived ? 'Archived' : 'Active'}</b>
        <span>Notes</span>
        <b>{selected.note || '—'}</b>
      </div>
    </>
  );
}

function AccountRouteController({
  model,
  workbook,
  onAction,
  onCommandResult,
  commandExecutor,
  services,
  initialShowArchived = false,
  initialSelectedAccountId = '',
  createRequestId = 0,
  onCreateRequestHandled,
  asOfDate = '',
  asOfLabel = ''
}) {
  const actions = useActionBindings();
  const [showArchived, setShowArchived] = useState(() =>
    Boolean(model?.showArchived || initialShowArchived)
  );
  const [selectedAccountId, setSelectedAccountId] = useState(
    () => model?.selectedAccount?.id || initialSelectedAccountId
  );
  const [accountSearch, setAccountSearch] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState('all');
  const [accountView, setAccountView] = useState('list');
  const [modal, setModal] = useState(null);
  const [transactionDetail, setTransactionDetail] = useState(null);
  const transactionDetailTrigger = useRef(null);
  const transactionDetailWasOpen = useRef(false);
  const activeModal =
    modal || (createRequestId ? { kind: 'create', account: null, error: '' } : null);
  const resolvedModel = useMemo(
    () =>
      workbook
        ? buildAccountsFeatureModel(workbook, {
            showArchived,
            selectedAccountId,
            asOfDate,
            asOfLabel
          })
        : model || {},
    [asOfDate, asOfLabel, model, selectedAccountId, showArchived, workbook]
  );
  const allRows = asArray(resolvedModel.accountRows);
  const rows = allRows.filter((row) => {
    if (!(showArchived || !row.isArchived)) return false;
    if (
      accountTypeFilter !== 'all' &&
      row.subtype !== accountTypeFilter &&
      row.contextKind !== accountTypeFilter &&
      row.group !== accountTypeFilter
    )
      return false;
    const query = accountSearch.trim().toLowerCase();
    if (!query) return true;
    return [row.name, row.typeLabel, row.institution].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query)
    );
  });
  const selected = resolvedModel.selectedAccount || null;

  useEffect(() => {
    if (transactionDetail) {
      transactionDetailWasOpen.current = true;
      return;
    }
    if (!transactionDetailWasOpen.current) return;
    transactionDetailWasOpen.current = false;
    transactionDetailTrigger.current?.focus();
  }, [transactionDetail]);

  function openModal(kind, row = null) {
    setModal({ kind, account: row, error: '' });
  }

  function runCommand(action) {
    onAction?.(action);
    if (!workbook) {
      setModal(null);
      if (action?.type === ACCOUNT_ACTIONS.CREATE) onCreateRequestHandled?.();
      return;
    }
    const executor =
      typeof commandExecutor === 'function' ? commandExecutor : executeAccountCommand;
    const result = executor(workbook, action, services);
    if (result?.ok) {
      const createdEvent = asArray(result.events).find((event) => event.type === 'account.created');
      if (createdEvent?.accountId) setSelectedAccountId(createdEvent.accountId);
      setModal(null);
      if (action?.type === ACCOUNT_ACTIONS.CREATE) onCreateRequestHandled?.();
    } else {
      setModal((current) => ({
        ...(current || { kind: 'create', account: null }),
        error: result?.errors?.[0]?.message || 'The account change could not be completed.'
      }));
    }
    onCommandResult?.(result);
  }

  const toggleBinding = actions.change('toggle-archived-accounts');
  const boundToggle = toggleBinding.onChange;
  const createBinding = withClick(actions.action('open-account-create'), () => openModal('create'));
  const defaultDate = asOfDate || `${Number(workbook?.year) || 1970}-01-01`;
  const modalAccount = activeModal?.account?.id
    ? asArray(workbook?.accounts).find((account) => account.id === activeModal.account.id) ||
      activeModal.account
    : activeModal?.account;

  return (
    <section data-react-route="accounts">
      <PageHeader title="Accounts" />
      <section className="summary-card-grid accounts-summary-grid">
        <StatCard
          binding={actions.action('open-dashboard-account-group', { accountGroup: 'net-worth' })}
          icon="account_balance"
          label="Net Worth"
          subtitle={resolvedModel.asOfLabel}
          tone={resolvedModel.summary?.netWorthTone}
          value={resolvedModel.summary?.netWorthCopy}
        />
        <StatCard
          binding={actions.action('open-dashboard-account-group', { accountGroup: 'asset' })}
          icon="payments"
          label="Assets"
          subtitle={resolvedModel.asOfLabel}
          tone="good"
          value={resolvedModel.summary?.assetCopy}
        />
        <StatCard
          binding={actions.action('open-dashboard-account-group', { accountGroup: 'liability' })}
          icon="credit_card"
          label="Credit Card Outstanding"
          subtitle={resolvedModel.asOfLabel}
          tone="bad"
          value={resolvedModel.summary?.creditCopy}
        />
        <StatCard
          icon="group"
          label="Accounts"
          subtitle="Across all types"
          value={String(allRows.filter((row) => !row.isArchived).length)}
        />
      </section>
      <section className="accounts-layout-grid">
        <article className="reference-card reference-card-wide">
          <div className="accounts-register-toolbar">
            <div className="accounts-register-heading">
              <h3>All Accounts</h3>
              <small>
                {rows.length} account{rows.length === 1 ? '' : 's'}
              </small>
            </div>
            <div className="accounts-register-actions">
              <div aria-label="Account view" className="account-view-toggle" role="group">
                <button
                  aria-label="Grid view"
                  aria-pressed={accountView === 'grid'}
                  className={`btn btn-icon${accountView === 'grid' ? ' active' : ''}`}
                  onClick={() => setAccountView('grid')}
                  type="button"
                >
                  <Icon name="grid_view" />
                </button>
                <button
                  aria-label="List view"
                  aria-pressed={accountView === 'list'}
                  className={`btn btn-icon${accountView === 'list' ? ' active' : ''}`}
                  onClick={() => setAccountView('list')}
                  type="button"
                >
                  <Icon name="view_list" />
                </button>
              </div>
            </div>
            <div className="accounts-register-filters">
              <select
                aria-label="Filter account type"
                onChange={(event) => setAccountTypeFilter(event.target.value)}
                value={accountTypeFilter}
              >
                <option value="all">All Types</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="wallet">E-Wallet</option>
                <option value="credit_card">Credit Card</option>
                <option value="investment">Investment</option>
                <option value="liability">Liability</option>
                <option value="other_asset">Other Asset</option>
              </select>
              <label className="accounts-search">
                <Icon name="search" />
                <input
                  aria-label="Search accounts"
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder="Search accounts…"
                  value={accountSearch}
                />
              </label>
              <label className="toggle-inline active-only-toggle">
                <input
                  checked={!showArchived}
                  type="checkbox"
                  {...toggleBinding}
                  onChange={(event) => {
                    boundToggle?.(event);
                    setShowArchived(!event.currentTarget.checked);
                  }}
                />{' '}
                Active only
              </label>
            </div>
          </div>
          <AccountCollection
            actions={actions}
            createBinding={createBinding}
            emptyCopy={allRows.length ? 'No accounts match these filters.' : 'No accounts yet.'}
            onSelect={setSelectedAccountId}
            rows={rows}
            view={accountView}
          />
          <p className="accounts-register-footer">
            Showing {rows.length ? `1 to ${rows.length}` : '0'} of {allRows.length} accounts
          </p>
        </article>
        <aside className="reference-card account-detail-card">
          <AccountDetail
            actions={actions}
            editBinding={actions.action('open-account-editor', { accountId: selected?.id || '' })}
            historyBinding={actions.action('open-account-transactions', {
              accountId: selected?.id || ''
            })}
            onEdit={() => openModal('edit', selected)}
            onOpenModal={openModal}
            onSelectTransaction={(transaction, trigger) => {
              transactionDetailTrigger.current = trigger;
              setTransactionDetail(transaction);
            }}
            selected={selected}
          />
        </aside>
      </section>
      {activeModal?.kind === 'create' ? (
        <AccountCreateWizard
          defaultCurrency={resolvedModel.currency}
          defaultDate={defaultDate}
          error={activeModal.error}
          onCancel={() => {
            setModal(null);
            onCreateRequestHandled?.();
          }}
          onSubmit={(payload) => runCommand({ type: ACCOUNT_ACTIONS.CREATE, payload })}
        />
      ) : null}
      {activeModal?.kind === 'edit' ? (
        <AccountEditModal
          key={`${activeModal.kind}-${modalAccount?.id || 'new'}`}
          account={modalAccount}
          balanceCopy={
            selected?.id === modalAccount?.id ? selected.balanceCopy : 'Balance unavailable'
          }
          balanceLabel={selected?.id === modalAccount?.id ? selected.balanceLabel : 'Balance'}
          context={selected?.id === modalAccount?.id ? selected.contextKind : ''}
          currencyLocked={selected?.id === modalAccount?.id && selected.hasHistory === true}
          error={activeModal.error}
          onCancel={() => setModal(null)}
          onSubmit={(payload) => runCommand({ type: ACCOUNT_ACTIONS.UPDATE, payload })}
        />
      ) : null}
      {activeModal?.kind === 'repair-currency' ? (
        <AccountCurrencyRepairModal
          account={activeModal.account}
          error={activeModal.error}
          onCancel={() => setModal(null)}
          onConfirm={() =>
            runCommand({
              type: ACCOUNT_ACTIONS.REPAIR_CURRENCY,
              payload: {
                accountId: activeModal.account.id,
                targetCurrency: activeModal.account.repairPreview?.targetCurrency,
                expectedFingerprint: activeModal.account.repairPreview?.fingerprint,
                confirmed: true
              }
            })
          }
          preview={activeModal.account.repairPreview}
        />
      ) : null}
      {activeModal && ['archive', 'restore', 'retire', 'delete'].includes(activeModal.kind) ? (
        <AccountConfirmationModal
          account={activeModal.account}
          error={activeModal.error}
          mode={activeModal.kind}
          onCancel={() => setModal(null)}
          onConfirm={() =>
            runCommand({
              type: {
                archive: ACCOUNT_ACTIONS.ARCHIVE,
                restore: ACCOUNT_ACTIONS.RESTORE,
                retire: ACCOUNT_ACTIONS.RETIRE,
                delete: ACCOUNT_ACTIONS.DELETE
              }[activeModal.kind],
              payload: { accountId: activeModal.account.id }
            })
          }
        />
      ) : null}
      <AccountTransactionDetailModal
        onClose={() => setTransactionDetail(null)}
        transaction={transactionDetail}
      />
    </section>
  );
}

export function AccountRoute(props) {
  return (
    <ActionBindingProvider onAction={props.onAction}>
      <AccountRouteController {...props} />
    </ActionBindingProvider>
  );
}
