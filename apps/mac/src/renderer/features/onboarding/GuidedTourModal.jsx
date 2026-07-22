import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function Icon({ name }) {
  return (
    <span aria-hidden="true" className="material-symbols-rounded">
      {name}
    </span>
  );
}

function DashboardIllustration() {
  return (
    <div className="tour-mock tour-mock-split">
      <div className="tour-mock-sidebar">
        <span className="tour-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="tour-mock-nav active">
          <Icon name="space_dashboard" />
          Dashboard
        </span>
        <span className="tour-mock-nav">
          <Icon name="receipt_long" />
          Transactions
        </span>
        <span className="tour-mock-nav">
          <Icon name="account_balance_wallet" />
          Accounts
        </span>
        <span className="tour-mock-nav">
          <Icon name="savings" />
          Budgets
        </span>
      </div>
      <div className="tour-mock-panel">
        <small>Net worth</small>
        <p className="tour-mock-amount">
          52,846.21<em className="tour-mock-delta">+2.4%</em>
        </p>
        <span className="tour-mock-range">
          <b className="active">1M</b>
          <b>3M</b>
          <b>6M</b>
          <b>YTD</b>
          <b>1Y</b>
        </span>
        <svg fill="none" preserveAspectRatio="none" viewBox="0 0 220 64">
          <path
            d="M4 52 C28 48, 40 34, 62 38 S104 54, 126 40 158 14, 178 20 208 10, 216 8"
            stroke="var(--accent)"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <path
            d="M4 52 C28 48, 40 34, 62 38 S104 54, 126 40 158 14, 178 20 208 10, 216 8 L216 64 L4 64 Z"
            fill="var(--accent-soft)"
          />
        </svg>
      </div>
    </div>
  );
}

function LedgerIllustration() {
  const rows = [
    { icon: 'shopping_cart', label: 'Groceries', amount: '-1,240.00', tone: 'bad' },
    { icon: 'payments', label: 'Salary', amount: '+45,000.00', tone: 'good' },
    { icon: 'local_cafe', label: 'Coffee', amount: '-180.00', tone: 'bad' },
    { icon: 'sync_alt', label: 'Transfer to savings', amount: '5,000.00', tone: '' }
  ];
  return (
    <div className="tour-mock tour-mock-list">
      {rows.map((row) => (
        <div className="tour-mock-row" key={row.label}>
          <span className="tour-mock-chip">
            <Icon name={row.icon} />
          </span>
          <span className="tour-mock-row-copy">
            <b>{row.label}</b>
            <i className="tour-mock-bar" />
          </span>
          <span className={`tour-mock-amount-tag ${row.tone}`}>{row.amount}</span>
        </div>
      ))}
    </div>
  );
}

function AccountsIllustration() {
  const accounts = [
    { icon: 'account_balance', label: 'Checking', amount: '32,410.90' },
    { icon: 'savings', label: 'Savings', amount: '18,935.31' },
    { icon: 'credit_card', label: 'Credit card', amount: '-1,500.00' }
  ];
  return (
    <div className="tour-mock tour-mock-cards">
      {accounts.map((account) => (
        <div className="tour-mock-card" key={account.label}>
          <span className="tour-mock-chip">
            <Icon name={account.icon} />
          </span>
          <b>{account.label}</b>
          <span className="tour-mock-card-amount">{account.amount}</span>
        </div>
      ))}
    </div>
  );
}

function BudgetsIllustration() {
  const budgets = [
    { label: 'Food', percent: 62, tone: '' },
    { label: 'Transport', percent: 38, tone: '' },
    { label: 'Fun money', percent: 91, tone: 'warn' }
  ];
  return (
    <div className="tour-mock tour-mock-list">
      {budgets.map((budget) => (
        <div className="tour-mock-budget" key={budget.label}>
          <span>
            <b>{budget.label}</b>
            <small>{budget.percent}%</small>
          </span>
          <span className="tour-mock-meter">
            <i className={budget.tone} style={{ width: `${budget.percent}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function BillsIllustration() {
  const bills = [
    { day: '01', label: 'Rent', amount: '12,000.00', due: true },
    { day: '12', label: 'Streaming', amount: '549.00', due: false },
    { day: '27', label: 'Internet', amount: '1,699.00', due: false }
  ];
  return (
    <div className="tour-mock tour-mock-list">
      {bills.map((bill) => (
        <div className="tour-mock-row" key={bill.label}>
          <span className="tour-mock-chip tour-mock-day">{bill.day}</span>
          <span className="tour-mock-row-copy">
            <b>{bill.label}</b>
            <i className="tour-mock-bar" />
          </span>
          {bill.due ? <span className="tour-mock-due">Due soon</span> : null}
          <span className="tour-mock-amount-tag">{bill.amount}</span>
        </div>
      ))}
    </div>
  );
}

function AssistantIllustration() {
  return (
    <div className="tour-mock tour-mock-chat">
      <span className="tour-mock-bubble user">Where is my money going?</span>
      <span className="tour-mock-bubble">
        <i className="tour-mock-bar wide" />
        <i className="tour-mock-bar" />
        <i className="tour-mock-bar short" />
      </span>
      <span className="tour-mock-composer">
        Ask Cavalry anything…
        <kbd>⌘ J</kbd>
      </span>
    </div>
  );
}

function WrapUpIllustration() {
  return (
    <div className="tour-mock tour-mock-wrapup">
      <span className="tour-mock-check">
        <Icon name="check" />
      </span>
      <span className="tour-mock-composer">
        Jump anywhere, run any action
        <kbd>⌘ K</kbd>
      </span>
    </div>
  );
}

const TOUR_SLIDES = Object.freeze([
  {
    id: 'dashboard',
    title: 'This is your Dashboard',
    body: 'See an overview of your finances at a glance. We’ll help you make sense of the big picture.',
    illustration: DashboardIllustration
  },
  {
    id: 'ledger',
    title: 'Every move, in one ledger',
    body: 'Record income, spending, and transfers — or import them — and Cavalry keeps the story straight.',
    illustration: LedgerIllustration
  },
  {
    id: 'accounts',
    title: 'Know where your money lives',
    body: 'Track balances across cash, banks, cards, and anything else you own or owe.',
    illustration: AccountsIllustration
  },
  {
    id: 'budgets',
    title: 'Set simple monthly budgets',
    body: 'Give categories a monthly limit and watch how you’re pacing before the month gets away.',
    illustration: BudgetsIllustration
  },
  {
    id: 'bills',
    title: 'Stay ahead of bills & subscriptions',
    body: 'See what’s due next so a recurring charge never takes you by surprise.',
    illustration: BillsIllustration
  },
  {
    id: 'assistant',
    title: 'Meet your AI Companion',
    body: 'Ask questions in plain language and let Cavalry find answers or take action. Press ⌘J anytime.',
    illustration: AssistantIllustration
  },
  {
    id: 'wrapup',
    title: 'You’re all set',
    body: 'One last tip: press ⌘K to jump anywhere or run quick actions. Ready to make Cavalry yours?',
    illustration: WrapUpIllustration
  }
]);

export function GuidedTourModal({ onSkip, onComplete }) {
  const [index, setIndex] = useState(0);
  const slide = TOUR_SLIDES[index];
  const isLastSlide = index === TOUR_SLIDES.length - 1;
  const Illustration = slide.illustration;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onSkip?.();
      if (event.key === 'ArrowRight') {
        setIndex((current) => Math.min(current + 1, TOUR_SLIDES.length - 1));
      }
      if (event.key === 'ArrowLeft') {
        setIndex((current) => Math.max(current - 1, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSkip]);

  return createPortal(
    <div className="modal-backdrop onboarding-backdrop">
      <section
        aria-labelledby="onboarding-tour-title"
        aria-modal="true"
        className="modal-card onboarding-tour"
        role="dialog"
      >
        <header className="onboarding-tour-header">
          <strong>Guided Tour</strong>
          <span className="onboarding-tour-count">
            {index + 1} of {TOUR_SLIDES.length}
          </span>
          <button
            aria-label="Skip the tour"
            className="btn btn-icon"
            onClick={onSkip}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div aria-hidden="true" className="onboarding-tour-stage">
          <Illustration />
        </div>
        <div className="onboarding-tour-copy">
          <h1 id="onboarding-tour-title">{slide.title}</h1>
          <p>{slide.body}</p>
        </div>
        <footer className="onboarding-tour-footer">
          <button className="btn btn-quiet" onClick={onSkip} type="button">
            Skip tour
          </button>
          <span aria-hidden="true" className="onboarding-tour-dots">
            {TOUR_SLIDES.map((dotSlide, dotIndex) => (
              <button
                className={dotIndex === index ? 'active' : ''}
                key={dotSlide.id}
                onClick={() => setIndex(dotIndex)}
                tabIndex={-1}
                type="button"
              />
            ))}
          </span>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (isLastSlide) onComplete?.();
              else setIndex((current) => current + 1);
            }}
            type="button"
          >
            {isLastSlide ? 'Start setup' : 'Next'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
