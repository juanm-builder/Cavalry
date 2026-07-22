const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

const appRoot = path.resolve(__dirname, '..');
const userDataPath =
  process.env.CAVALRY_SMOKE_USER_DATA ||
  path.join(os.tmpdir(), 'cavalry-core-dom-smoke-' + String(process.pid));

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.setPath('userData', userDataPath);

function makeSmokeWorkbook() {
  return {
    id: 'wb_dom_smoke',
    version: 2,
    name: 'DOM Smoke Workbook',
    year: 2026,
    currency: 'PHP',
    settings: {
      usdToBaseRate: 58,
      fileAutosave: {
        enabled: false,
        fileName: '',
        lastSavedAt: '',
        lastError: ''
      }
    },
    accounts: [
      {
        id: 'cash',
        name: 'Cash',
        group: 'asset',
        subtype: 'cash',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'bank',
        name: 'Bank',
        group: 'asset',
        subtype: 'bank',
        currency: 'PHP',
        openedDate: '2026-01-01',
        isActive: true
      },
      {
        id: 'food-expense',
        name: 'Food Expense',
        group: 'expense',
        subtype: 'expense',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'salary-income',
        name: 'Salary Income',
        group: 'income',
        subtype: 'income',
        currency: 'PHP',
        isActive: true
      },
      {
        id: 'opening_balance_equity',
        name: 'Opening Balance Equity',
        group: 'equity',
        subtype: 'opening_balance',
        currency: 'PHP',
        isSystem: true,
        isActive: true
      }
    ],
    categories: [
      {
        id: 'food',
        name: 'Food',
        type: 'expense',
        currency: 'PHP',
        linkedAccountId: 'food-expense',
        plannerBucketId: 'bucket-food',
        isActive: true
      },
      {
        id: 'salary',
        name: 'Salary',
        type: 'income',
        currency: 'PHP',
        linkedAccountId: 'salary-income',
        plannerBucketId: 'bucket-income',
        isActive: true
      }
    ],
    counterparties: [],
    transactions: [],
    recurringItems: [],
    sheets: [
      {
        id: 'sheet-2026-07',
        monthIndex: 6,
        budgets: [],
        budgetLineItems: [],
        entries: []
      }
    ],
    aiDrafts: [],
    externalDraftGroups: [],
    advisorDraftGroups: [],
    advisorThreads: []
  };
}

function makePortableWorkbookHtml(workbook) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Cavalry Workbook Export</title></head>' +
    '<body><script id="ledger-grove-export" type="application/json">' +
    JSON.stringify(workbook).replace(/<\/script/gi, '<\\/script') +
    '</script></body></html>'
  );
}

function pageSmokeScript() {
  return `
    (async function () {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      window.__domSmokeAlerts = [];
      window.alert = (message) => window.__domSmokeAlerts.push(String(message || ''));
      window.confirm = (message) => {
        window.__domSmokeAlerts.push('confirm: ' + String(message || ''));
        return true;
      };

      async function waitFor(predicate, label, timeoutMs = 10000) {
        const startedAt = Date.now();
        let lastError = null;
        while (Date.now() - startedAt < timeoutMs) {
          try {
            if (predicate()) return true;
          } catch (error) {
            lastError = error;
          }
          await sleep(50);
        }
        const persisted = window.cavalrySmoke && window.cavalrySmoke.getWorkbook();
        throw new Error(
          'Timed out waiting for ' + label +
          (lastError ? ': ' + lastError.message : '') +
          ' | alerts=' + JSON.stringify(window.__domSmokeAlerts || []) +
          ' | persisted=' + JSON.stringify(persisted || null).slice(0, 1600) +
          ' | body=' + normalize(document.body.innerText).slice(0, 1800)
        );
      }

      function query(selector, root = document) {
        const element = root.querySelector(selector);
        if (!element) throw new Error('Missing selector: ' + selector);
        return element;
      }

      function namedControl(name, root = document) {
        const expected = normalize(name);
        const control = Array.from(root.querySelectorAll('button, summary')).find((element) => {
          return normalize(element.getAttribute('aria-label')) === expected ||
            normalize(element.getAttribute('title')) === expected ||
            normalize(element.textContent) === expected;
        });
        if (!control) throw new Error('Missing control named "' + name + '" in ' + normalize(root.textContent).slice(0, 500));
        return control;
      }

      function clickNamed(name, root = document) {
        const control = namedControl(name, root);
        control.click();
        return control;
      }

      function nativeValueSetter(element) {
        if (element instanceof HTMLSelectElement) return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        if (element instanceof HTMLTextAreaElement) return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      }

      function setValue(selector, value, root = document) {
        const element = query(selector, root);
        nativeValueSetter(element).call(element, String(value));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function rowContaining(value) {
        const expected = normalize(value);
        const row = Array.from(document.querySelectorAll('main tr')).find((element) => normalize(element.textContent).includes(expected));
        if (!row) throw new Error('Missing table row containing "' + value + '".');
        return row;
      }

      async function navigate(label, routeName) {
        const button = Array.from(document.querySelectorAll('aside.nav-rail button')).find((element) => {
          return normalize(element.getAttribute('title')) === label || normalize(element.getAttribute('aria-label')).startsWith(label);
        });
        if (!button) throw new Error('Missing navigation button: ' + label);
        button.click();
        await waitFor(() => document.querySelector('[data-react-route="' + routeName + '"]'), label + ' route');
      }

      async function openTransactionComposer() {
        const header = query('main .page-header');
        clickNamed('Add Transaction', header);
        await waitFor(() => document.querySelector('[data-react-modal="transaction-composer"]'), 'transaction composer');
        return query('[data-react-modal="transaction-composer"]');
      }

      async function createTransaction(input) {
        const modal = await openTransactionComposer();
        const categoryId = input.categoryId || (Array.from(modal.querySelectorAll('#transaction-category option')).find((option) => normalize(option.textContent) === input.categoryName) || {}).value;
        const accountId = input.accountId || (Array.from(modal.querySelectorAll('#transaction-primary-account option')).find((option) => normalize(option.textContent) === input.accountName) || {}).value;
        setValue('#transaction-template', input.template || 'expense_paid', modal);
        setValue('#transaction-date', input.date, modal);
        setValue('#transaction-description', input.description, modal);
        setValue('#transaction-amount', input.amount, modal);
        setValue('#transaction-currency', input.currency || 'PHP', modal);
        setValue('#transaction-category', categoryId, modal);
        setValue('#transaction-primary-account', accountId, modal);
        clickNamed('Add Transaction', modal);
        await waitFor(() => !document.querySelector('[data-react-modal="transaction-composer"]'), 'transaction submit');
        await waitFor(() => normalize(document.body.innerText).includes(input.description), 'transaction row ' + input.description);
      }

      await waitFor(() => document.querySelector('[data-react-route="dashboard"]'), 'hydrated dashboard');
      const initialWorkbook = window.cavalrySmoke.getWorkbook();
      if (!(initialWorkbook && initialWorkbook.id === 'wb_dom_smoke')) {
        throw new Error('The native workbook did not hydrate through the production preload contract.');
      }

      await navigate('Transactions', 'transactions');
      await createTransaction({
        date: '2026-07-02',
        description: 'DOM smoke coffee',
        amount: '125',
        categoryId: 'food',
        accountId: 'cash'
      });

      let transactionRow = rowContaining('DOM smoke coffee');
      clickNamed('Transaction actions', transactionRow);
      clickNamed('Edit transaction', transactionRow);
      await waitFor(() => document.querySelector('[data-react-modal="transaction-composer"]'), 'transaction editor');
      const editModal = query('[data-react-modal="transaction-composer"]');
      setValue('#transaction-description', 'DOM smoke coffee edited', editModal);
      setValue('#transaction-amount', '175', editModal);
      clickNamed('Save Changes', editModal);
      await waitFor(() => normalize(document.body.innerText).includes('DOM smoke coffee edited'), 'edited transaction row');

      transactionRow = rowContaining('DOM smoke coffee edited');
      clickNamed('Transaction actions', transactionRow);
      clickNamed('Delete transaction', transactionRow);
      await waitFor(() => document.querySelector('[data-react-modal="transaction-delete"]'), 'delete transaction dialog');
      clickNamed('Delete Transaction', query('[data-react-modal="transaction-delete"]'));
      await waitFor(() => !normalize(document.body.innerText).includes('DOM smoke coffee edited'), 'deleted transaction');

      const csv = 'date,description,amount,account,category\\n2026-07-03,CSV smoke lunch,-210,Cash,Food\\n';
      const nativeInputClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return nativeInputClick.call(this);
        const input = this;
        const file = new File([csv], 'smoke-transactions.csv', { type: 'text/csv' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        queueMicrotask(() => input.dispatchEvent(new Event('change', { bubbles: true })));
      };
      clickNamed('Import CSV', query('main .page-header'));
      await waitFor(() => document.querySelector('[aria-label="CSV import preview"]'), 'CSV import preview');
      clickNamed('Apply Ready Rows', query('[aria-label="CSV import preview"]'));
      await waitFor(() => normalize(document.body.innerText).includes('Applied 1 ready row'), 'CSV import result');
      clickNamed('Close', query('[aria-label="CSV import preview"]'));
      HTMLInputElement.prototype.click = nativeInputClick;
      await waitFor(() => normalize(document.body.innerText).includes('CSV smoke lunch'), 'CSV imported transaction');

      await navigate('Accounts', 'accounts');
      clickNamed('Add Account', query('main .page-header'));
      await waitFor(() => document.querySelector('#account-name'), 'account create dialog');
      const accountDialog = query('#account-name').closest('[role="dialog"]');
      setValue('#account-name', 'Smoke Wallet', accountDialog);
      setValue('#account-group', 'asset', accountDialog);
      setValue('#account-subtype', 'wallet', accountDialog);
      setValue('#account-currency', 'PHP', accountDialog);
      setValue('#account-opened-date', '2026-07-01', accountDialog);
      clickNamed('Create Account', accountDialog);
      await waitFor(() => normalize(document.body.innerText).includes('Smoke Wallet'), 'created account');

      await navigate('Transactions', 'transactions');
      await createTransaction({
        date: '2026-07-04',
        description: 'DOM smoke wallet transaction',
        amount: '80',
        categoryId: 'food',
        accountName: 'Smoke Wallet'
      });

      await navigate('Accounts', 'accounts');
      const accountRow = rowContaining('Smoke Wallet');
      clickNamed('Account actions', accountRow);
      clickNamed('Archive account', accountRow);
      await waitFor(() => normalize(document.body.innerText).includes('Archive Account'), 'archive account confirmation');
      const archiveDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) => normalize(element.textContent).includes('Archive Account'));
      clickNamed('Archive Account', archiveDialog);
      await waitFor(() => !Array.from(document.querySelectorAll('main tr')).some((row) => normalize(row.textContent).includes('Smoke Wallet')), 'referenced account archived');
      const showArchived = Array.from(document.querySelectorAll('main input[type="checkbox"]')).find((input) => normalize(input.parentElement.textContent).includes('Show archived accounts'));
      showArchived.click();
      await waitFor(() => normalize(document.body.innerText).includes('Smoke Wallet') && normalize(rowContaining('Smoke Wallet').textContent).includes('Archived'), 'archived account remains in history');

      await navigate('Categories', 'categories');
      clickNamed('Add Category', query('main .page-header'));
      await waitFor(() => document.querySelector('#category-name'), 'category create dialog');
      const categoryDialog = query('#category-name').closest('[role="dialog"]');
      setValue('#category-name', 'Smoke Dining', categoryDialog);
      setValue('#category-type', 'expense', categoryDialog);
      setValue('#category-linked-account', 'Smoke Dining Expense', categoryDialog);
      clickNamed('Create Category', categoryDialog);
      await waitFor(() => normalize(document.body.innerText).includes('Smoke Dining'), 'created category');
      const categoryRow = rowContaining('Smoke Dining');
      clickNamed('Category actions', categoryRow);
      clickNamed('Hide category', categoryRow);
      await waitFor(() => normalize(document.body.innerText).includes('Hide Category'), 'hide category confirmation');
      const hideDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) => normalize(element.textContent).includes('Hide Category'));
      clickNamed('Hide Category', hideDialog);
      await waitFor(() => !Array.from(document.querySelectorAll('main tr')).some((row) => normalize(row.textContent).includes('Smoke Dining')), 'category hidden');
      const showHidden = Array.from(document.querySelectorAll('main input[type="checkbox"]')).find((input) => normalize(input.parentElement.textContent).includes('Show hidden'));
      showHidden.click();
      await waitFor(() => normalize(document.body.innerText).includes('Smoke Dining'), 'hidden category remains in history');

      window.cavalrySmoke.sendCommand({ type: 'open-draft-group', draftGroupId: 'smoke-draft-group' });
      await waitFor(() => document.querySelector('[data-react-route="ai-drafts"]'), 'draft deep link route');
      window.cavalrySmoke.sendCommand({ type: 'open-checkpoint', checkpointId: 'smoke-checkpoint' });
      await waitFor(() => document.querySelector('[data-react-route="ai-drafts"]'), 'checkpoint deep link route');

      const saveCallsBefore = window.cavalrySmoke.getCalls().filter((call) => call.name === 'saveActiveWorkbook').length;
      window.cavalrySmoke.sendCommand({ type: 'save-workbook' });
      await waitFor(() => window.cavalrySmoke.getCalls().filter((call) => call.name === 'saveActiveWorkbook').length > saveCallsBefore, 'native save');
      const saveAsCallsBefore = window.cavalrySmoke.getCalls().filter((call) => call.name === 'saveWorkbookAs').length;
      window.cavalrySmoke.sendCommand({ type: 'save-workbook-as' });
      await waitFor(() => window.cavalrySmoke.getCalls().filter((call) => call.name === 'saveWorkbookAs').length > saveAsCallsBefore, 'native save as');

      const persisted = window.cavalrySmoke.getWorkbook();
      const persistedWallet = (persisted.accounts || []).find((account) => account.name === 'Smoke Wallet');
      const persistedCategory = (persisted.categories || []).find((category) => category.name === 'Smoke Dining');
      if (!(persisted.transactions || []).some((transaction) => transaction.description === 'CSV smoke lunch')) {
        throw new Error('CSV transaction was not serialized to the native workbook.');
      }
      if (!(persisted.transactions || []).some((transaction) => transaction.description === 'DOM smoke wallet transaction')) {
        throw new Error('Manual transaction was not serialized to the native workbook.');
      }
      if (!(persistedWallet && persistedWallet.isActive === false)) {
        throw new Error('Referenced account archive was not serialized.');
      }
      if (!(persistedCategory && persistedCategory.isActive === false)) {
        throw new Error('Category visibility change was not serialized.');
      }

      return {
        ok: true,
        persisted: {
          walletId: persistedWallet.id,
          categoryId: persistedCategory.id,
          transactionCount: persisted.transactions.length
        },
        bridgeCalls: window.cavalrySmoke.getCalls().map((call) => call.name)
      };
    })();
  `;
}

function reloadVerificationScript(expected) {
  return `
    (async function () {
      const expected = ${JSON.stringify(expected)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      async function waitFor(predicate, label, timeoutMs = 10000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (predicate()) return true;
          await sleep(50);
        }
        throw new Error('Timed out waiting for ' + label + ' after reload | body=' + normalize(document.body.innerText).slice(0, 1800));
      }
      function navigationButton(label) {
        return Array.from(document.querySelectorAll('aside.nav-rail button')).find((element) => {
          return normalize(element.getAttribute('title')) === label || normalize(element.getAttribute('aria-label')).startsWith(label);
        });
      }
      await waitFor(() => document.querySelector('[data-react-route="dashboard"]'), 'hydrated dashboard');
      const workbook = window.cavalrySmoke.getWorkbook();
      const wallet = (workbook.accounts || []).find((account) => account.id === expected.walletId);
      const category = (workbook.categories || []).find((item) => item.id === expected.categoryId);
      if (!(wallet && wallet.isActive === false && category && category.isActive === false)) {
        throw new Error('Archived entities were not restored from the saved native workbook.');
      }
      navigationButton('Transactions').click();
      await waitFor(() => document.querySelector('[data-react-route="transactions"]'), 'transactions after reload');
      await waitFor(() => normalize(document.body.innerText).includes('CSV smoke lunch') && normalize(document.body.innerText).includes('DOM smoke wallet transaction'), 'saved transactions after reload');
      const openCallsBefore = window.cavalrySmoke.getCalls().filter((call) => call.name === 'openWorkbookFile').length;
      window.cavalrySmoke.sendCommand({ type: 'open-workbook' });
      await waitFor(() => window.cavalrySmoke.getCalls().filter((call) => call.name === 'openWorkbookFile').length > openCallsBefore, 'native reopen command');
      await waitFor(() => normalize(document.body.innerText).includes('CSV smoke lunch'), 'transactions after native reopen');
      return { ok: true, transactionCount: (window.cavalrySmoke.getWorkbook().transactions || []).length };
    })();
  `;
}

async function reloadWindow(win) {
  await new Promise((resolve, reject) => {
    const onFailed = (_event, code, description) => {
      cleanup();
      reject(
        new Error(
          'Renderer reload failed (' + String(code) + '): ' + String(description || 'unknown error')
        )
      );
    };
    const onFinished = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      win.webContents.removeListener('did-fail-load', onFailed);
      win.webContents.removeListener('did-finish-load', onFinished);
    };
    win.webContents.once('did-fail-load', onFailed);
    win.webContents.once('did-finish-load', onFinished);
    win.webContents.reload();
  });
}

async function run() {
  await fs.rm(userDataPath, { recursive: true, force: true });
  await fs.mkdir(userDataPath, { recursive: true });
  const smokeWorkbook = makeSmokeWorkbook();
  process.env.CAVALRY_SMOKE_WORKBOOK_BASE64 = Buffer.from(
    makePortableWorkbookHtml(smokeWorkbook),
    'utf8'
  ).toString('base64');
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'core-dom-smoke-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  const consoleLines = [];
  win.webContents.on('console-message', (_event, level, message) => {
    consoleLines.push({ level, message });
  });
  try {
    await win.loadFile(path.join(appRoot, 'dist', 'renderer', 'index.html'));
    const firstPass = await win.webContents.executeJavaScript(pageSmokeScript(), true);
    if (!(firstPass && firstPass.ok)) throw new Error('DOM smoke did not return an ok result.');
    await reloadWindow(win);
    const reloadPass = await win.webContents.executeJavaScript(
      reloadVerificationScript(firstPass.persisted),
      true
    );
    if (!(reloadPass && reloadPass.ok))
      throw new Error('DOM reload smoke did not return an ok result.');
    console.log(JSON.stringify({ ok: true, firstPass, reloadPass }, null, 2));
  } catch (error) {
    error.message += '\nRenderer console: ' + JSON.stringify(consoleLines.slice(-30));
    throw error;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

app
  .whenReady()
  .then(run)
  .then(() => {
    app.quit();
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
