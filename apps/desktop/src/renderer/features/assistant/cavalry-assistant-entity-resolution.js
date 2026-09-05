import {
  findInstitutionById,
  getLedgerTransactionTemplateConfig,
  resolveInstitution
} from '@cavalry/finance-core';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function textKey(value) {
  return asText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueText(values) {
  const seen = new Set();
  return asArray(values)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(asText)
    .filter((value) => {
      const key = textKey(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function accountIsCard(account) {
  const descriptor = textKey(
    [
      account?.name,
      account?.subtype,
      account?.details?.cardNetwork,
      account?.details?.accountReference
    ]
      .map(asText)
      .join(' ')
  );
  return (
    asText(account?.group) === 'liability' &&
    /\b(?:card|visa|mastercard|amex|jcb)\b/.test(descriptor)
  );
}

function accountIsWallet(account) {
  return /\b(?:wallet|e wallet|ewallet|gcash|maya|grabpay|shopeepay|coins ph)\b/.test(
    textKey([account?.name, account?.subtype, account?.institution].join(' '))
  );
}

function accountIsLoan(account) {
  return /\b(?:loan|mortgage|credit line|line of credit)\b/.test(
    textKey([account?.name, account?.subtype].join(' '))
  );
}

function institutionForAccount(account) {
  return (
    findInstitutionById(asText(account?.institutionId)) ||
    resolveInstitution(asText(account?.institution)) ||
    null
  );
}

function accountAliases(account) {
  const details = asObject(account?.details);
  const institution = institutionForAccount(account);
  const institutionAliases = uniqueText([
    account?.institution,
    institution?.shortName,
    institution?.name,
    institution?.aliases
  ]);
  const aliases = [account?.name, account?.aliases, details.aliases];

  institutionAliases.forEach((alias) => {
    aliases.push(alias);
    if (accountIsCard(account)) {
      aliases.push(`${alias} card`, `${alias} credit card`);
    } else if (asText(account?.group) === 'asset') {
      aliases.push(`${alias} bank`, `${alias} bank account`);
    }
  });

  if (accountIsCard(account)) {
    aliases.push('credit card', 'card');
    const network = asText(details.cardNetwork);
    if (network) aliases.push(network, `${network} card`);
  }
  if (accountIsLoan(account)) aliases.push('loan', 'debt account');
  if (accountIsWallet(account)) aliases.push('wallet', 'e-wallet');
  if (textKey(account?.subtype) === 'cash' || textKey(account?.name) === 'cash')
    aliases.push('cash');

  const reference = asText(details.accountReference || details.identifier);
  const accountNumber = asText(details.accountNumber).replace(/\s+/g, '');
  const lastFour = accountNumber.length >= 4 ? accountNumber.slice(-4) : '';
  if (reference) aliases.push(reference);
  if (lastFour) {
    aliases.push(lastFour);
    if (accountIsCard(account)) {
      aliases.push(`card ${lastFour}`);
      institutionAliases.forEach((alias) => aliases.push(`${alias} ${lastFour}`));
    }
  }
  return uniqueText(aliases);
}

function aliasPattern(alias) {
  const tokens = textKey(alias).split(' ').filter(Boolean).map(escapeRegExp);
  return tokens.length ? `\\b${tokens.join('\\s+')}\\b` : '';
}

function mentionIsNegated(prompt, start) {
  const prefix = String(prompt || '').slice(Math.max(0, start - 90), start);
  return /\b(?:do\s+not|don'?t|not|never|except|excluding|without|instead\s+of|rather\s+than)\s+(?:(?:from|using|with|via|out\s+of|on|to|into|toward|towards|in|use)\s+)?(?:my\s+|the\s+)?$/i.test(
    prefix
  );
}

const ROLE_PREFIX = Object.freeze({
  source: '(?:from|out\\s+of|using|with|via|move(?:d)?(?:\\s+money)?(?:\\s+from)?)',
  funding: '(?:from|out\\s+of|use|using|with|via|paid\\s+from)',
  charged: '(?:charged\\s+(?:to|on)|to|on|using|with)',
  destination: '(?:to|into|onto|toward|towards|deposit(?:ed)?\\s+(?:to|into))',
  receiving: '(?:to|into|onto|in|received\\s+(?:to|into)|deposit(?:ed)?\\s+(?:to|into))',
  account: '(?:on|in|for|using|with|account)'
});

function roleForTransaction(template, secondary = false) {
  const value = asText(template) || 'expense_paid';
  if (value === 'transfer') return secondary ? 'destination' : 'source';
  if (value === 'debt_payment' || value === 'liability_payment') {
    return secondary ? 'destination' : 'funding';
  }
  if (value === 'expense_charged') return 'charged';
  if (value === 'income_received' || value === 'merchant_refund') return 'receiving';
  if (value === 'expense_paid') return 'funding';
  return 'account';
}

function candidateAccounts(workbook, groups, { includeArchived = false } = {}) {
  return asArray(workbook?.accounts).filter(
    (account) =>
      account &&
      account.isSystem !== true &&
      (includeArchived || account.isActive !== false) &&
      (!groups.length || groups.includes(asText(account.group)))
  );
}

function buildAliasIndex(accounts) {
  const aliases = new Map();
  asArray(accounts).forEach((account) => {
    accountAliases(account).forEach((alias) => {
      const key = textKey(alias);
      const entry = aliases.get(key) || { alias, accounts: [] };
      if (!entry.accounts.includes(account)) entry.accounts.push(account);
      if (asText(alias).length > asText(entry.alias).length) entry.alias = alias;
      aliases.set(key, entry);
    });
  });
  return aliases;
}

function referenceResolution(accounts, reference) {
  const supplied = asText(reference);
  if (!supplied) return { status: 'omitted', reference: '' };
  const key = textKey(supplied);
  const exactId = accounts.filter((account) => asText(account?.id) === supplied);
  if (exactId.length === 1) {
    return {
      status: 'resolved',
      account: exactId[0],
      reference: supplied,
      provenance: 'stable_id'
    };
  }
  const indexed = buildAliasIndex(accounts).get(key);
  if (!indexed) return { status: 'not_found', reference: supplied, candidates: [] };
  if (indexed.accounts.length > 1) {
    return {
      status: 'ambiguous',
      reference: supplied,
      candidates: indexed.accounts,
      provenance: 'argument_alias'
    };
  }
  const account = indexed.accounts[0];
  return {
    status: 'resolved',
    account,
    reference: supplied,
    provenance: textKey(account?.name) === key ? 'exact_name' : 'alias'
  };
}

function promptMentions(accounts, prompt, role, { assignment = false } = {}) {
  const source = asText(prompt);
  if (!source) return [];
  const matches = [];
  const rolePrefix = ROLE_PREFIX[role] || '';
  buildAliasIndex(accounts).forEach((entry) => {
    const pattern = aliasPattern(entry.alias);
    if (!pattern) return;
    const expression = new RegExp(pattern, 'gi');
    for (const match of source.matchAll(expression)) {
      const start = match.index || 0;
      if (mentionIsNegated(source, start)) continue;
      const prefix = source.slice(Math.max(0, start - 90), start);
      const roleSpecific = rolePrefix
        ? new RegExp(`\\b${rolePrefix}\\s+(?:my\\s+|the\\s+)?$`, 'i').test(prefix)
        : false;
      const differentRoleSpecific = Object.entries(ROLE_PREFIX).some(
        ([candidateRole, candidatePrefix]) =>
          candidateRole !== role &&
          new RegExp(`\\b${candidatePrefix}\\s+(?:my\\s+|the\\s+)?$`, 'i').test(prefix)
      );
      const assignmentSpecific =
        assignment &&
        /\b(?:change|correct|move|reassign|set|switch|update)\b[^.!?]{0,100}\b(?:to|into|onto)\s+(?:my\s+|the\s+)?$/i.test(
          prefix
        );
      matches.push({
        alias: entry.alias,
        accounts: entry.accounts,
        start,
        length: asText(match[0]).length,
        roleSpecific,
        differentRoleSpecific,
        assignmentSpecific
      });
    }
  });
  return matches;
}

function bestPromptResolution(accounts, prompt, role, options = {}) {
  const allMentions = promptMentions(accounts, prompt, role, options);
  if (!allMentions.length) return { status: 'omitted', reference: '' };
  const mentions = allMentions.filter(
    (mention) =>
      !allMentions.some(
        (other) =>
          other !== mention &&
          other.length > mention.length &&
          other.start <= mention.start &&
          other.start + other.length >= mention.start + mention.length
      )
  );
  const assignmentMentions = mentions.filter((mention) => mention.assignmentSpecific);
  const roleMentions = mentions.filter((mention) => mention.roleSpecific);
  const unassignedMentions = mentions.filter((mention) => !mention.differentRoleSpecific);
  const relevant = assignmentMentions.length
    ? assignmentMentions
    : roleMentions.length
      ? roleMentions
      : unassignedMentions;
  if (!relevant.length) {
    return {
      status: 'not_found',
      reference: uniqueText(mentions.map((mention) => mention.alias)).join(' / '),
      candidates: [],
      provenance: 'role_mismatch'
    };
  }
  const longest = Math.max(...relevant.map((mention) => mention.length));
  const strongest = relevant.filter((mention) => mention.length === longest);
  const candidates = Array.from(new Set(strongest.flatMap((mention) => mention.accounts)));
  const reference = uniqueText(strongest.map((mention) => mention.alias)).join(' / ');
  if (candidates.length !== 1) {
    return {
      status: 'ambiguous',
      reference,
      candidates,
      provenance: assignmentMentions.length
        ? 'explicit_assignment'
        : roleMentions.length
          ? 'explicit_role'
          : 'explicit_mention'
    };
  }
  return {
    status: 'resolved',
    account: candidates[0],
    reference,
    provenance: assignmentMentions.length
      ? 'explicit_assignment'
      : roleMentions.length
        ? 'explicit_role'
        : 'explicit_mention'
  };
}

const FREEFORM_ROLE_CUES = Object.freeze({
  source: [
    /\b(?:move|moved|transfer|transferred|send|sent)\b[^.!?]{0,80}\bfrom\s+(?:my\s+|the\s+)?([^,.;!?\n]{1,60})/gi
  ],
  funding: [
    /\b(?:pay|paid|spend|spent|buy|bought|purchase|purchased)\b[^.!?]{0,80}\b(?:from|out\s+of|using|with|via)\s+(?:my\s+|the\s+)?([^,.;!?\n]{1,60})/gi
  ],
  charged: [
    /\b(?:charge|charged|put)\b[^.!?]{0,80}\b(?:to|on|using|with)\s+(?:my\s+|the\s+)?([^,.;!?\n]{1,60})/gi
  ],
  destination: [
    /\b(?:move|moved|transfer|transferred|send|sent|wire|wired|deposit|deposited)\b[^.!?]{0,80}\b(?:to|into|onto|toward|towards)\s+(?:my\s+|the\s+)?([^,.;!?\n]{1,60})/gi,
    /\b(?:pay|paid|settle|settled)\s+(?:off\s+)?(?:(?:[A-Z]{3}\s*)?[\d,.]+\s+(?:(?:[A-Z]{3})\s+)?(?:to\s+)?)?(?:my\s+|the\s+)?([^,.;!?\n]{1,60}?)(?=\s+\b(?:from|out\s+of|using|with|via)\b)/gi
  ],
  receiving: [
    /\b(?:receive|received|deposit|deposited|refund|refunded|return|returned|credit|credited|pay|paid)\b[^.!?]{0,80}\b(?:to|into|onto)\s+(?:my\s+|the\s+)?([^,.;!?\n]{1,60})/gi
  ]
});

function freeformCueName(value) {
  const candidate = asText(value)
    .replace(/^["'“‘]|["'”’]$/g, '')
    .split(/\s+\b(?:for|because|dated|date|category|and\s+then|then|but|while)\b/i, 1)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate || candidate.length > 60) return '';
  if (/^(?:an?|my|the|this|that|it|them|there)$/i.test(candidate)) return '';
  if (/^(?:[A-Z]{3}\s*)?[\d,.]+(?:\s+[A-Z]{3})?$/i.test(candidate)) return '';
  return candidate;
}

function unmatchedExplicitCue(prompt, role) {
  const source = asText(prompt);
  const prefix = ROLE_PREFIX[role];
  if (!source || !prefix) return '';
  const accountCue = '(?:account|bank|card|credit\\s+card|wallet|cash|visa|mastercard|amex|jcb)';
  if (
    new RegExp(`\\b${prefix}\\s+(?:my\\s+|the\\s+)?[^,.;!?]{0,60}\\b${accountCue}\\b`, 'i').test(
      source
    )
  ) {
    return 'named in the request';
  }
  const candidates = asArray(FREEFORM_ROLE_CUES[role]).flatMap((pattern) => {
    pattern.lastIndex = 0;
    return Array.from(source.matchAll(pattern), (match) => freeformCueName(match[1])).filter(
      Boolean
    );
  });
  return candidates.at(-1) || '';
}

function accountSummary(account) {
  return {
    id: asText(account?.id),
    name: asText(account?.name),
    group: asText(account?.group),
    subtype: asText(account?.subtype),
    institution: asText(account?.institution)
  };
}

function finalized(result, role) {
  const next = { ...result, role };
  if (result.account) {
    next.id = asText(result.account.id);
    next.name = asText(result.account.name);
  }
  if (result.candidates) next.candidates = result.candidates.map(accountSummary);
  return next;
}

export function resolveCavalryAssistantAccount(
  workbook,
  {
    reference = '',
    prompt = '',
    groups = [],
    role = 'account',
    includeArchived = false,
    assignment = false
  } = {}
) {
  const accounts = candidateAccounts(workbook, asArray(groups), { includeArchived });
  const explicit = bestPromptResolution(accounts, prompt, role, { assignment });
  if (explicit.status !== 'omitted' && explicit.provenance !== 'role_mismatch') {
    return finalized(explicit, role);
  }
  const unmatchedCue = unmatchedExplicitCue(prompt, role);
  if (unmatchedCue) {
    return finalized({ status: 'not_found', reference: unmatchedCue, candidates: [] }, role);
  }
  if (explicit.status !== 'omitted') return finalized(explicit, role);
  return finalized(referenceResolution(accounts, reference), role);
}

export function resolveCavalryAssistantTransactionAccount(
  workbook,
  {
    template = 'expense_paid',
    secondary = false,
    reference = '',
    prompt = '',
    assignment = false
  } = {}
) {
  const config = getLedgerTransactionTemplateConfig(template);
  const groups = secondary ? asArray(config.secondaryGroups) : asArray(config.primaryGroups);
  const role = roleForTransaction(template, secondary);
  if (!groups.length) return { status: 'omitted', reference: '', role };
  return resolveCavalryAssistantAccount(workbook, {
    reference,
    prompt,
    groups,
    role,
    assignment
  });
}

export function cavalryAssistantAccountResolutionError(result, field, label = 'Account') {
  const source = asObject(result);
  const candidates = asArray(source.candidates);
  if (source.status === 'ambiguous') {
    const names = candidates
      .slice(0, 5)
      .map((account) => `${asText(account.name)} (${asText(account.id)})`)
      .join(', ');
    return {
      status: 'ambiguous_reference',
      error: {
        code: 'ambiguous_reference',
        field,
        message: `${label} “${asText(source.reference) || 'that wording'}” matches more than one active account${
          names ? `: ${names}` : ''
        }. Choose the intended account.`
      }
    };
  }
  if (source.status === 'not_found') {
    return {
      status: 'validation_failed',
      error: {
        code: 'reference_not_found',
        field,
        message: `${label} “${asText(source.reference) || 'named in the request'}” was not found among active compatible accounts.`
      }
    };
  }
  return null;
}
