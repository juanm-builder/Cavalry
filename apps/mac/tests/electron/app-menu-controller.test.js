// Pins menu command dispatch after moving menu construction out of main.cjs.

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildCavalryAppMenuTemplate,
  installCavalryAppMenu
} = require('../../src/main/app-menu-controller.cjs');

function getMenuItem(template, label) {
  return template.flatMap((menu) => menu.submenu || []).find((item) => item.label === label);
}

describe('Electron app menu controller', () => {
  it('builds the expected workbook command menu items', () => {
    const sentCommands = [];
    const template = buildCavalryAppMenuTemplate({
      appName: 'Cavalry Test',
      sendCommand: (command) => sentCommands.push(command)
    });

    expect(template[0].label).toBe('Cavalry Test');
    expect(getMenuItem(template, 'New Transaction').accelerator).toBe('Command+N');
    expect(getMenuItem(template, 'Open Workbook...').accelerator).toBe('Command+O');
    expect(getMenuItem(template, 'Save').accelerator).toBe('Command+S');
    expect(getMenuItem(template, 'Save As...').accelerator).toBe('Command+Shift+S');
    expect(getMenuItem(template, 'Settings').accelerator).toBe('Command+,');

    getMenuItem(template, 'New Transaction').click();
    getMenuItem(template, 'Open Workbook...').click();
    getMenuItem(template, 'Save').click();
    getMenuItem(template, 'Save As...').click();
    getMenuItem(template, 'Settings').click();

    expect(sentCommands).toEqual([
      'new-transaction',
      'open-workbook',
      'save-workbook',
      'save-workbook-as',
      'open-settings'
    ]);
  });

  it('places Check for Updates immediately after About and disables it when unavailable', () => {
    let checks = 0;
    const enabledTemplate = buildCavalryAppMenuTemplate({
      updatesEnabled: true,
      onCheckForUpdates: () => {
        checks += 1;
      }
    });
    const appMenu = enabledTemplate[0].submenu;

    expect(appMenu[0]).toEqual({ role: 'about' });
    expect(appMenu[1]).toMatchObject({ label: 'Check for Updates…', enabled: true });
    expect(appMenu[2]).toEqual({ type: 'separator' });
    appMenu[1].click();
    expect(checks).toBe(1);

    const disabledItem = buildCavalryAppMenuTemplate({ updatesEnabled: false })[0].submenu[1];
    expect(disabledItem).toMatchObject({ label: 'Check for Updates…', enabled: false });
  });

  it('installs the menu through injected Electron Menu APIs', () => {
    let builtTemplate = null;
    let installedMenu = null;
    const Menu = {
      buildFromTemplate(template) {
        builtTemplate = template;
        return { template };
      },
      setApplicationMenu(menu) {
        installedMenu = menu;
      }
    };

    const template = installCavalryAppMenu({
      Menu,
      appName: 'Cavalry Test'
    });

    expect(template).toBe(builtTemplate);
    expect(installedMenu).toEqual({ template });
  });
});
