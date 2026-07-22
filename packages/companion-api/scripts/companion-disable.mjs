import { repoPath, writeJson, writeText } from './companion-beta-utils.mjs';

const unsetCommands = [
  'unset CAVALRY_COMPANION_API_ENABLED',
  'unset CAVALRY_COMPANION_API_MODE',
  'unset CAVALRY_COMPANION_BETA_API_KEY',
  'unset CAVALRY_COMPANION_BETA_API_KEY_HASH',
  'unset CAVALRY_COMPANION_PUBLIC_BASE_URL'
];

const report = {
  generated_at: new Date().toISOString(),
  action: 'manual_cleanup_required',
  stopped_process: false,
  reason:
    'This CLI command cannot stop a separately launched terminal process unless a process manager is added later.',
  cleanup_checklist: [
    'Stop the Companion API terminal process with Ctrl-C.',
    'Stop the tunnel process.',
    'Unset Companion API env vars.',
    'Rotate the beta token before the next test.',
    'Run npm run status --workspace @cavalry/companion-api to confirm the next shell is clean.'
  ],
  unset_commands: unsetCommands,
  production_cloud_ready: false
};

writeJson(repoPath('test-artifacts/companion-disable/report.json'), report);
writeText(
  repoPath('test-artifacts/companion-disable/report.md'),
  [
    '# Companion API Disable / Cleanup',
    '',
    'Generated at: `' + report.generated_at + '`',
    '',
    'This command does not print tokens and does not assume ownership of another terminal process.',
    '',
    '## Checklist',
    '',
    ...report.cleanup_checklist.map((item) => '- [ ] ' + item),
    '',
    '## Env Vars To Unset',
    '',
    '```sh',
    ...unsetCommands,
    '```',
    ''
  ].join('\n')
);

console.log(
  'Companion API cleanup checklist generated: test-artifacts/companion-disable/report.md'
);
console.log('');
console.log('Stop the Companion API process with Ctrl-C, stop the tunnel, then run:');
unsetCommands.forEach((command) => console.log(command));
console.log('');
console.log('Rotate the beta token before the next test.');
