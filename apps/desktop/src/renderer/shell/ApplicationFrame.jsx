import React, { useEffect, useState } from 'react';

import { useAppearance } from '../app/AppearanceProvider.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { SidebarNavigation } from './SidebarNavigation.jsx';
import { WorkbookTopBar } from './WorkbookTopBar.jsx';

export function ApplicationFrame({
  workbook,
  activeRouteId,
  save = {},
  pendingDraftCount = 0,
  userInitials,
  userLabel,
  update,
  mainClassName = '',
  onNavigate,
  onAddTransaction,
  onAddAccount,
  onAskAssistant,
  onAskAdvisor,
  onOpenSetupGuide,
  setupProgress = null,
  children
}) {
  const { preferences, toggleNavigation } = useAppearance();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigationCompact = preferences.navigation === 'compact';
  const mainClasses = ['app-main', mainClassName].filter(Boolean).join(' ');

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`app-shell${navigationCompact ? ' navigation-compact' : ''}`}>
      <SidebarNavigation
        activeRouteId={activeRouteId}
        compact={navigationCompact}
        onAddAccount={onAddAccount}
        onAddTransaction={onAddTransaction}
        onNavigate={onNavigate}
        pendingDraftCount={pendingDraftCount}
        userInitials={userInitials}
        userLabel={userLabel}
        update={update}
        workbookName={workbook?.name}
      />
      <div className="content-shell">
        <WorkbookTopBar
          navigationCompact={navigationCompact}
          onAskAssistant={onAskAssistant}
          onAskAdvisor={onAskAdvisor}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenSetupGuide={onOpenSetupGuide}
          onToggleNavigation={toggleNavigation}
          save={save}
          setupProgress={setupProgress}
          workbook={workbook}
        />
        <main aria-label="Workbook content" className={mainClasses}>
          {children}
        </main>
      </div>
      {commandPaletteOpen ? (
        <CommandPalette
          activeRouteId={activeRouteId}
          onAddAccount={onAddAccount}
          onAddTransaction={onAddTransaction}
          onAskAssistant={onAskAssistant}
          onAskAdvisor={onAskAdvisor}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={onNavigate}
          onOpenSetupGuide={onOpenSetupGuide}
        />
      ) : null}
    </div>
  );
}
