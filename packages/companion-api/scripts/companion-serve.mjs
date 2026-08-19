import { startCavalryApiServer } from '../src/server/cavalry-api/server.js';
import { getCompanionApiRuntimeConfig } from '../src/server/cavalry-api/runtime.js';

function getArg(name) {
  const prefix = '--' + name + '=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function hasFlag(name) {
  return process.argv.includes('--' + name);
}

function redact(value) {
  return value ? value.replace(/\/+$/g, '') : '(not configured)';
}

try {
  const modeArg =
    getArg('mode') || (hasFlag('local') ? 'local_dev' : hasFlag('beta') ? 'beta_tunnel' : '');
  const runtime = getCompanionApiRuntimeConfig({
    enabled: modeArg ? true : undefined,
    mode: modeArg || undefined
  });
  const result = await startCavalryApiServer({ runtimeConfig: runtime });
  const url = result.url;
  console.log('');
  console.log(
    runtime.mode === 'beta_tunnel'
      ? 'Cavalry Companion API beta tunnel mode is ON.'
      : 'Cavalry Companion API'
  );
  if (runtime.mode === 'beta_tunnel') {
    console.log('External callers can create reviewable drafts only.');
    console.log('No draft can be applied through this API.');
    console.log('Use a test workbook first.');
    console.log('Disable this when you are done.');
    console.log('');
  }
  console.log('Mode: ' + runtime.mode);
  console.log('Bind: ' + runtime.bindHost + ':' + String(runtime.bindPort));
  console.log('Local URL: ' + url);
  console.log('Public base URL: ' + redact(runtime.publicBaseUrl));
  console.log('Auth: ' + (runtime.authRequired ? 'required' : 'not required'));
  console.log('AI action mode: ' + runtime.aiActionMode);
  console.log('Checkpointed apply enabled: ' + String(runtime.checkpointedApplyEnabled === true));
  console.log(
    'Scopes: read capabilities/workbooks/summary/accounts/categories/recent transactions, create/read drafts'
  );
  console.log('Draft-only guarantee: yes');
  console.log('Production cloud ready: no');
  console.log('Review URL scheme: cavalry://draft-groups/{id}');
  console.log('Docs: docs/integrations/companion-api-power-user-beta.md');
  console.log('Doctor: npm run beta:doctor --workspace @cavalry/companion-api');
  console.log('Beta certification: npm run beta:certify --workspace @cavalry/companion-api');
  console.log('');
  console.log('External callers can create drafts only. Apply still happens inside Cavalry.');
  console.log(
    'Live app bridge: run the Cavalry Tauri desktop app for the API to see the workbook currently open in the UI.'
  );
  console.log(
    'Standalone companion:serve has no open app workbook unless a workbook store is supplied by code/tests.'
  );
  if (runtime.mode === 'beta_tunnel') {
    console.log(
      'Warning: beta tunnel mode may expose financial endpoints while this process is running.'
    );
    console.log(
      'Warning: anyone with the public URL and beta token can call the beta API until you stop it.'
    );
  }
  if (runtime.aiActionMode === 'checkpointed_apply') {
    console.log(
      'Warning: checkpointed apply can mutate workbook data under reversible checkpoints. Use a test workbook first.'
    );
  }
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
