// Locks down account route markup, selected account detail, balance toggles, and action affordances.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccountRoute } from '../../src/renderer/features/accounts/AccountRoute.jsx';

function makeAccountModel() {
  return {
    currency: 'PHP',
    asOfLabel: 'June 30, 2026',
    showArchived: true,
    summary: {
      netWorthCopy: 'PHP 48,301.00',
      netWorthTone: 'good',
      assetCopy: 'PHP 49,501.00',
      creditCopy: 'PHP 1,200.00'
    },
    accountRows: [
      {
        id: 'bank-checking',
        name: 'Bank Checking',
        currency: 'PHP',
        isArchived: false,
        isSelected: true,
        icon: 'account_balance',
        tone: 'good',
        typeLabel: 'Asset Account',
        institution: 'Bank',
        institutionId: 'rcbc',
        institutionColor: '#0067b1',
        balanceCell: {
          accountId: 'bank-checking',
          copy: 'PHP 49,501.00',
          tone: 'good',
          canToggle: false
        },
        activityCopy: '+PHP 47,971.00',
        activityPercent: '12.5',
        activityTone: 'good',
        canRestore: false,
        canPostDailyInterest: true,
        canRedeemTimeDeposit: false,
        canRetire: false,
        canDelete: true
      },
      {
        id: 'paypal',
        name: 'PayPal',
        currency: 'USD',
        isArchived: false,
        isSelected: false,
        icon: 'account_balance',
        tone: 'good',
        typeLabel: 'Asset Account',
        institution: 'Wallet',
        balanceCell: { accountId: 'paypal', copy: 'PHP 580.00', tone: 'good', canToggle: true },
        activityCopy: 'PHP 0.00',
        activityPercent: '',
        activityTone: 'good',
        canRestore: false,
        canPostDailyInterest: false,
        canRedeemTimeDeposit: false,
        canRetire: false,
        canDelete: true
      },
      {
        id: 'credit-card',
        name: 'Credit Card',
        currency: 'PHP',
        isArchived: false,
        isSelected: false,
        icon: 'credit_card',
        tone: 'bad',
        typeLabel: 'Liability',
        institution: 'Credit Card',
        balanceCell: {
          accountId: 'credit-card',
          copy: 'PHP 1,200.00',
          tone: 'bad',
          canToggle: false
        },
        activityCopy: '-PHP 500.00',
        activityPercent: '8',
        activityTone: 'good',
        canRestore: false,
        canPostDailyInterest: false,
        canRedeemTimeDeposit: false,
        canRetire: true,
        canDelete: true
      },
      {
        id: 'old-wallet',
        name: 'Old Wallet',
        currency: 'PHP',
        isArchived: true,
        isSelected: false,
        icon: 'account_balance',
        tone: 'good',
        typeLabel: 'Asset Account',
        institution: 'Wallet',
        balanceCell: { accountId: 'old-wallet', copy: 'PHP 75.00', tone: 'good', canToggle: false },
        activityCopy: 'PHP 0.00',
        activityPercent: '',
        activityTone: 'good',
        canRestore: true,
        canPostDailyInterest: false,
        canRedeemTimeDeposit: false,
        canRetire: false,
        canDelete: true
      }
    ],
    selectedAccount: {
      id: 'bank-checking',
      name: 'Bank Checking',
      currency: 'PHP',
      openedDate: '2026-01-01',
      isArchived: false,
      icon: 'account_balance',
      tone: 'good',
      typeLabel: 'Asset Account',
      institution: 'Bank',
      institutionId: 'rcbc',
      institutionColor: '#0067b1',
      balanceCopy: 'PHP 49,501.00',
      balanceTone: 'good',
      changeCopy: '+PHP 47,971.00',
      changeTone: 'good',
      changePercentCopy: '12.5% June 1 - 30, 2026',
      asOfLabel: 'June 30, 2026',
      historyRows: [
        {
          transactionId: 'txn-1',
          date: '2026-06-01',
          runningBalance: 50000,
          balanceCopy: 'PHP 50k',
          title: '2026-06-01 - PHP 50,000.00'
        },
        {
          transactionId: 'txn-2',
          date: '2026-06-02',
          runningBalance: 49501,
          balanceCopy: 'PHP 49.5k',
          title: '2026-06-02 - PHP 49,501.00'
        }
      ]
    }
  };
}

function renderAccountRoute(model = makeAccountModel()) {
  return renderToStaticMarkup(React.createElement(AccountRoute, { model }));
}

describe('AccountRoute', () => {
  it('renders account summary, table rows, and selected account detail', () => {
    const html = renderAccountRoute();

    expect(html).toContain('data-react-route="accounts"');
    expect(html).toContain('Accounts');
    expect(html).toContain('Net Worth');
    expect(html).toContain('Credit Card Outstanding');
    expect(html).toContain('Create account');
    expect(html).toContain('account-create-entry');
    expect(html).toContain('data-account-view="list"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Bank Checking');
    expect(html).toContain('PayPal');
    expect(html).toContain('Credit Card');
    expect(html).toContain('is-archived');
    expect(html).toContain('is-selected');
    expect(html).toContain('data-institution-id="rcbc"');
    expect(html).toContain(
      'aria-label="Open Bank Checking account, Asset Account, Bank, Balance PHP 49,501.00'
    );
    expect(html).toContain('View Transactions</button>');
    expect(html).toContain('class="account-history-line"');
  });

  it('keeps account actions in the detail card instead of every table row', () => {
    const html = renderAccountRoute();

    expect(html).toContain('data-account-id="bank-checking"');
    expect(html).toContain('class="account-list-card-financial"');
    expect(html).toContain('aria-label="More account options"');
    expect(html).toContain('Edit Account');
    expect(html).toContain('Archive Account');
    expect(html).toContain('Delete Account');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="action-cell"');
    expect(html).not.toContain('data-action=');
  });

  it('renders empty account and selected detail states', () => {
    const html = renderAccountRoute({
      asOfLabel: 'No date',
      showArchived: false,
      summary: {},
      accountRows: [],
      selectedAccount: null
    });

    expect(html).toContain('No accounts yet.');
    expect(html).toContain('Create account');
    expect(html).toContain('Select or add an account.');
    expect(html).not.toContain('data-action="select-account"');
  });
});
