import {
  generateCompanionBetaToken,
  hashCompanionBetaToken,
  hasCompanionBetaTokenConfig,
  verifyCompanionBetaToken
} from '../src/server/cavalry-api/beta-token.js';

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function command() {
  return asString(process.argv[2] || 'create').replace(/^--/, '');
}

function isEnabledEnvironmentFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(asString(value).toLowerCase());
}

function canRevealGeneratedToken() {
  return (
    process.stdout.isTTY === true &&
    !isEnabledEnvironmentFlag(process.env.CI) &&
    !isEnabledEnvironmentFlag(process.env.GITHUB_ACTIONS)
  );
}

function printCreate({ rotate = false, checkpointed = false } = {}) {
  if (!canRevealGeneratedToken()) {
    console.error(
      'Refusing to print a newly generated Companion API token outside an interactive terminal.'
    );
    console.error(
      'Run this command locally in a terminal. In automation, create the credential in a secret manager and configure only its hash.'
    );
    process.exitCode = 1;
    return;
  }
  const token = generateCompanionBetaToken();
  const hash = hashCompanionBetaToken(token);
  console.log(
    rotate
      ? 'Cavalry Companion API beta token rotation'
      : checkpointed
        ? 'Cavalry Companion API checkpointed beta token'
        : 'Cavalry Companion API beta token'
  );
  console.log('');
  if (checkpointed) {
    console.log(
      'WARNING: This token can ask Cavalry to apply reversible checkpointed changes when checkpointed mode and scopes are enabled.'
    );
    console.log(
      'Use a test workbook first. Never share this token. Stop the tunnel after testing.'
    );
    console.log('');
  }
  console.log('Raw token, shown once:');
  console.log(token);
  console.log('');
  console.log('Recommended server env var:');
  console.log('export CAVALRY_COMPANION_BETA_API_KEY_HASH="' + hash + '"');
  if (checkpointed) {
    console.log('export CAVALRY_COMPANION_AI_ACTION_MODE="checkpointed_apply"');
    console.log('export CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1');
    console.log('export CAVALRY_COMPANION_BETA_ENABLE_CHECKPOINTED_SCOPE=1');
  }
  console.log('');
  console.log('Custom GPT Action auth value:');
  console.log('Use the raw token above as the Bearer/API key value.');
  console.log('');
  console.log(
    checkpointed
      ? 'This token can read permitted Cavalry context, create drafts, and ask Cavalry to apply reversible checkpointed changes while enabled.'
      : 'This token can read permitted Cavalry context and create reviewable drafts while the beta API/tunnel is running.'
  );
  console.log('Treat it like a password. If it leaks, disable the API and rotate the token.');
  console.log('Cavalry will not write the plaintext token to repo files.');
}

function printHash() {
  const token = asString(
    process.argv[3] ||
      process.env.CAVALRY_COMPANION_BETA_API_KEY ||
      process.env.CAVALRY_COMPANION_BETA_TOKEN_TO_HASH
  );
  if (!token) {
    console.error(
      'Set CAVALRY_COMPANION_BETA_API_KEY or pass a token argument to hash. The token will not be stored.'
    );
    process.exit(1);
  }
  console.log('CAVALRY_COMPANION_BETA_API_KEY_HASH=' + hashCompanionBetaToken(token));
}

function printVerify() {
  const candidate = asString(
    process.argv[3] ||
      process.env.CAVALRY_COMPANION_BETA_TOKEN_TO_VERIFY ||
      process.env.CAVALRY_COMPANION_BETA_API_KEY
  );
  if (!hasCompanionBetaTokenConfig()) {
    console.error(
      'No beta token configuration found. Set CAVALRY_COMPANION_BETA_API_KEY or CAVALRY_COMPANION_BETA_API_KEY_HASH.'
    );
    process.exit(1);
  }
  if (!candidate) {
    console.log('Beta token configuration is present.');
    console.log(
      'No raw candidate token was provided, so this command did not print or compare a secret.'
    );
    return;
  }
  if (!verifyCompanionBetaToken(candidate)) {
    console.error('Beta token verification failed.');
    process.exit(1);
  }
  console.log('Beta token verification passed.');
}

function printRotate() {
  console.log('To rotate a beta token:');
  console.log('1. Stop the Companion API process.');
  console.log('2. Stop the public tunnel.');
  console.log(
    '3. Remove the old CAVALRY_COMPANION_BETA_API_KEY or CAVALRY_COMPANION_BETA_API_KEY_HASH from your shell/session.'
  );
  console.log(
    '4. Use the new token below for the Custom GPT Action and the new hash for server config.'
  );
  console.log('');
  printCreate({ rotate: true });
}

const cmd = command();
if (cmd === 'create') {
  printCreate();
} else if (cmd === 'create:checkpointed') {
  printCreate({ checkpointed: true });
} else if (cmd === 'hash') {
  printHash();
} else if (cmd === 'verify') {
  printVerify();
} else if (cmd === 'rotate') {
  printRotate();
} else {
  console.error('Unknown companion beta token command: ' + cmd);
  console.error('Use one of: create, hash, verify, rotate');
  process.exit(1);
}
