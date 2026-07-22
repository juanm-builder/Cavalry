import {
  BETA_BUNDLE_DIR,
  asString,
  chmodExecutable,
  ensureDirectory,
  generateBetaOpenApiArtifacts,
  packagePath,
  readText,
  repoPath,
  scanTextFilesForTokenLeaks,
  validateGeneratedOpenApi,
  writeJson,
  writeText
} from './companion-beta-utils.mjs';
import { repoRelativePath } from './companion-paths.mjs';

function fail(message) {
  console.error('Companion beta bundle failed:', message);
  process.exit(1);
}

function copyText(source, destination) {
  writeText(destination, readText(source));
}

try {
  const bundleDir = repoPath(BETA_BUNDLE_DIR);
  ensureDirectory(bundleDir);
  const generated = generateBetaOpenApiArtifacts({ outDir: BETA_BUNDLE_DIR });
  validateGeneratedOpenApi(generated.yamlPath);

  copyText(
    packagePath('examples/custom-gpt-instructions.md'),
    repoPath(BETA_BUNDLE_DIR, 'custom-gpt-instructions.md')
  );

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'README.md'),
    [
      '# Cavalry Companion API Custom GPT Beta Bundle',
      '',
      'This bundle is for a power-user beta tunnel test. It is not production cloud.',
      '',
      '## Product Loop',
      '',
      '1. ChatGPT understands the user.',
      '2. ChatGPT calls Cavalry through the configured HTTPS tunnel.',
      '3. Cavalry creates reviewable drafts.',
      '4. The user reviews in Cavalry.',
      '5. Cavalry applies only what the user approves.',
      '',
      '## Readiness',
      '',
      '- Local/dev ready: true',
      '- Beta tunnel testable if this public URL reaches your running local API: `' +
        generated.publicBaseUrl +
        '`',
      '- Production cloud ready: false',
      '',
      '## Files',
      '',
      '- `custom-gpt-instructions.md`: paste into the Custom GPT instructions field.',
      '- `cavalry-gpt-actions.beta.openapi.yaml`: import or paste as the GPT Action schema.',
      '- `cavalry-gpt-actions.beta.openapi.json`: same schema as JSON.',
      '- `setup-checklist.md`: setup sequence.',
      '- `manual-test-script.md`: exact Preview prompts and expected outcomes.',
      '- `curl-smoke-tests.sh`: optional command-line smoke checks.',
      '- `privacy-and-safety-notes.md`: what can leave the machine during Path A.',
      '',
      '## Shutdown',
      '',
      'Stop the Cavalry Companion API process, stop the tunnel process, unset beta env vars, and rotate the beta token after testing.',
      '',
      '```sh',
      'unset CAVALRY_COMPANION_API_ENABLED',
      'unset CAVALRY_COMPANION_API_MODE',
      'unset CAVALRY_COMPANION_BETA_API_KEY',
      'unset CAVALRY_COMPANION_BETA_API_KEY_HASH',
      'unset CAVALRY_COMPANION_PUBLIC_BASE_URL',
      '```',
      ''
    ].join('\n')
  );

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'setup-checklist.md'),
    [
      '# Custom GPT Beta Setup Checklist',
      '',
      '- [ ] Open a synthetic or test Cavalry workbook first.',
      '- [ ] Run `npm run beta:doctor --workspace @cavalry/companion-api`.',
      '- [ ] Generate a beta token with `npm run token --workspace @cavalry/companion-api`.',
      '- [ ] Export `CAVALRY_COMPANION_API_ENABLED=1`.',
      '- [ ] Export `CAVALRY_COMPANION_API_MODE=beta_tunnel`.',
      '- [ ] Export `CAVALRY_COMPANION_BETA_API_KEY` or `CAVALRY_COMPANION_BETA_API_KEY_HASH`.',
      '- [ ] Start the local API with `npm run serve:beta --workspace @cavalry/companion-api`.',
      '- [ ] Start an HTTPS tunnel to the local URL.',
      '- [ ] Export `CAVALRY_COMPANION_PUBLIC_BASE_URL="' + generated.publicBaseUrl + '"`.',
      '- [ ] Regenerate this bundle with `npm run beta:bundle --workspace @cavalry/companion-api` if the URL changes.',
      '- [ ] Open ChatGPT and create a Custom GPT.',
      '- [ ] Paste `custom-gpt-instructions.md` into Instructions.',
      '- [ ] Add an Action and import `cavalry-gpt-actions.beta.openapi.yaml`.',
      '- [ ] Configure API key auth as Bearer token using the raw beta token.',
      '- [ ] Run the prompts in `manual-test-script.md`.',
      '- [ ] Confirm nothing mutates before approval inside Cavalry.',
      '- [ ] Stop the tunnel and API when finished.',
      ''
    ].join('\n')
  );

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'manual-test-script.md'),
    [
      '# Manual GPT Preview Test Script',
      '',
      '## What You Are Testing',
      '',
      'You are testing whether a Custom GPT can call Cavalry through a temporary beta tunnel and create reviewable drafts.',
      '',
      '## What You Are Not Testing',
      '',
      '- You are not testing production cloud.',
      '- You are not giving ChatGPT permission to apply drafts.',
      '- You are not shipping this to normal users yet.',
      '',
      '## Prompts',
      '',
      'Use these exactly:',
      '',
      '```text',
      'List my Cavalry workbooks.',
      '',
      'Show my Cavalry workbook summary.',
      '',
      'What accounts and categories can you use?',
      '',
      'Add a transaction: PHP 150 printer paper charged to Office Cash Account.',
      '',
      'Add 15 USD OpenAI API credits charged to my credit card.',
      '',
      'Create subscriptions for ChatGPT Pro, Vercel, Globe, and Prepaid Subscription.',
      '',
      'Create a category cleanup draft for these: move "Random" coffee rows to Food and "RFID Card Load" to Transport.',
      '',
      'Did I already add a transaction like PHP 150 printer paper charged to Office Cash Account?',
      '',
      'Apply the drafts for me.',
      '',
      'Delete all my transactions.',
      '```',
      '',
      '## Capture Table',
      '',
      '| Prompt | Operation called | API status | Draft group ID | Review URL opened? | Mutation before approval? | Apply/reject result | Notes |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ''
    ].join('\n')
  );

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'sample-prompts.md'),
    [
      '# Sample Prompts',
      '',
      '- List my Cavalry workbooks.',
      '- Show my Cavalry workbook summary.',
      '- Add a transaction: PHP 150 printer paper charged to Office Cash Account.',
      '- Add 15 USD OpenAI API credits charged to my credit card.',
      '- Create subscriptions for ChatGPT Pro, Vercel, Globe, and Prepaid Subscription.',
      '- Apply the drafts for me.',
      '- Delete all my transactions.',
      ''
    ].join('\n')
  );

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'sample-expected-results.md'),
    [
      '# Sample Expected Results',
      '',
      '- Read prompts call read endpoints and return concise structured context.',
      '- Add prompts call draft endpoints and return a `cavalry://draft-groups/...` review URL.',
      '- Cavalry opens the review UI; nothing changes before approval.',
      '- Credit-card wording creates an expense draft charged to the payment account, not a liability-account creation draft.',
      '- Subscription prompts create recurring-item drafts; ambiguous top-ups/load items need review.',
      '- Apply and delete requests are refused by the GPT because the API exposes no apply/delete/archive endpoints.',
      ''
    ].join('\n')
  );

  const curlPath = repoPath(BETA_BUNDLE_DIR, 'curl-smoke-tests.sh');
  writeText(
    curlPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'BASE_URL="${CAVALRY_COMPANION_PUBLIC_BASE_URL:-' + generated.publicBaseUrl + '}"',
      'TOKEN="${CAVALRY_COMPANION_BETA_API_KEY:?Set CAVALRY_COMPANION_BETA_API_KEY to the raw beta token for smoke tests}"',
      'WORKBOOK_ID="${CAVALRY_COMPANION_TEST_WORKBOOK_ID:-}"',
      '',
      'auth=(-H "Authorization: Bearer ${TOKEN}")',
      'json=(-H "Content-Type: application/json")',
      '',
      'curl -fsS "${auth[@]}" "${BASE_URL}/v1/capabilities"',
      'curl -fsS "${auth[@]}" "${BASE_URL}/v1/workbooks"',
      '',
      'if [[ -z "${WORKBOOK_ID}" ]]; then',
      '  echo "Set CAVALRY_COMPANION_TEST_WORKBOOK_ID after listing workbooks to create draft smoke tests."',
      '  exit 0',
      'fi',
      '',
      'curl -fsS "${auth[@]}" "${json[@]}" -H "Idempotency-Key: beta-smoke-transaction-1" \\',
      '  -d \'{"date_default":"2026-06-27","transactions":[{"description":"Printer paper","amount":150,"currency":"PHP","direction":"expense","payment_account_hint":"Office Cash Account","category_hint":"Office Supplies"}]}\' \\',
      '  "${BASE_URL}/v1/workbooks/${WORKBOOK_ID}/drafts/transaction-batch"',
      '',
      'curl -fsS "${auth[@]}" "${json[@]}" -H "Idempotency-Key: beta-smoke-recurring-1" \\',
      '  -d \'{"items":[{"name":"ChatGPT Pro","amount":6490,"currency":"PHP","cadence":"monthly","category_hint":"Subscriptions","confidence":"high"}]}\' \\',
      '  "${BASE_URL}/v1/workbooks/${WORKBOOK_ID}/drafts/recurring-items"',
      ''
    ].join('\n')
  );
  chmodExecutable(curlPath);

  writeText(
    repoPath(BETA_BUNDLE_DIR, 'privacy-and-safety-notes.md'),
    [
      '# Privacy And Safety Notes',
      '',
      'Path A is a power-user beta. Financial data can flow through ChatGPT, the GPT Action request/response, and your temporary tunnel while testing.',
      '',
      '## What Can Leave The Machine',
      '',
      '- Data returned by Cavalry read endpoints to the Custom GPT.',
      '- Draft request data ChatGPT sends to Cavalry through the tunnel.',
      '- Anything you type or paste into the Custom GPT conversation.',
      '- Any exposed beta API data if the public URL and beta token leak while the server is running.',
      '',
      '## What Does Not Happen Automatically',
      '',
      '- No automatic upload of the full workbook.',
      '- No direct apply.',
      '- No direct delete.',
      '- No direct workbook mutation.',
      '',
      '## Recommended Beta Practices',
      '',
      '- Use a test workbook first.',
      '- Keep recent transaction limits small.',
      '- Rotate the token after testing.',
      '- Stop the tunnel after testing.',
      '- Avoid real financial data until you are comfortable with the flow.',
      '- Inspect API responses and audit reports.',
      '',
      'Path B needs hosted HTTPS, OAuth, per-user auth, durable audit/idempotency/rate-limit stores, token revocation, monitoring, and privacy/legal review.',
      ''
    ].join('\n')
  );

  const bundleFiles = [
    'README.md',
    'custom-gpt-instructions.md',
    'cavalry-gpt-actions.beta.openapi.yaml',
    'cavalry-gpt-actions.beta.openapi.json',
    'setup-checklist.md',
    'manual-test-script.md',
    'sample-prompts.md',
    'sample-expected-results.md',
    'curl-smoke-tests.sh',
    'privacy-and-safety-notes.md'
  ].map((name) => repoPath(BETA_BUNDLE_DIR, name));
  const leaks = scanTextFilesForTokenLeaks(bundleFiles);
  if (leaks.length) {
    fail('Token-like secret found in bundle files: ' + leaks.join(', '));
  }

  writeJson(repoPath(BETA_BUNDLE_DIR, 'bundle-manifest.json'), {
    generated_at: new Date().toISOString(),
    public_base_url: generated.publicBaseUrl,
    files: bundleFiles.map(repoRelativePath),
    production_cloud_ready: false
  });

  console.log('Companion beta bundle generated:');
  console.log(bundleDir);
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
