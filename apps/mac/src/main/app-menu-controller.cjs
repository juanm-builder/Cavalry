// Builds the Mac app menu while keeping command dispatch injected by the main process.

function buildCavalryAppMenuTemplate(options = {}) {
  const appName = options.appName || 'Cavalry for Mac';
  const sendCommand =
    typeof options.sendCommand === 'function' ? options.sendCommand : function () {};
  const onCheckForUpdates =
    typeof options.onCheckForUpdates === 'function' ? options.onCheckForUpdates : function () {};
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        {
          label: 'Check for Updates…',
          enabled: options.updatesEnabled === true,
          click: () => onCheckForUpdates()
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Transaction',
          accelerator: 'Command+N',
          click: () => sendCommand('new-transaction')
        },
        { type: 'separator' },
        {
          label: 'Open Workbook...',
          accelerator: 'Command+O',
          click: () => sendCommand('open-workbook')
        },
        { label: 'Save', accelerator: 'Command+S', click: () => sendCommand('save-workbook') },
        {
          label: 'Save As...',
          accelerator: 'Command+Shift+S',
          click: () => sendCommand('save-workbook-as')
        },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'Command+,', click: () => sendCommand('open-settings') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
}

function installCavalryAppMenu(options = {}) {
  const Menu = options.Menu;
  if (!Menu) {
    throw new Error('Menu dependency is required.');
  }
  const template = buildCavalryAppMenuTemplate(options);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  return template;
}

module.exports = {
  buildCavalryAppMenuTemplate,
  installCavalryAppMenu
};
