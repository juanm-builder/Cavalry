const transferWords =
  /\b(?:transfer(?:red|ed|ring|s)?|tranfer(?:red|ed)?|tranfser|transfr|trnsfer|transferr|xfer(?:red)?|mov(?:e|ed|ing)|send|sent|withdraw(?:al|n)?|withdrew|cash(?:ed)?\s+out|deposit(?:ed)?|top[ -]?up|topped\s+up)\b/i;
const normalize = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const contains = (source, phrase) =>
  !!phrase && ` ${normalize(source)} `.includes(` ${normalize(phrase)} `);

export function hasNotesTransferWords(source) {
  // A payment method does not change a purchase into a movement between own accounts.
  return transferWords.test(
    String(source).replace(/\b(?:via|by|using|with)\s+(?:a\s+)?bank\s+transfer\b/gi, '')
  );
}

export function matchNotesAccounts(source, accounts) {
  const exact = accounts.filter((account) => contains(source, account.name));
  // Prefer a full account name over a generic name embedded in that same account name.
  const specific = exact.filter(
    (account) =>
      !exact.some(
        (other) =>
          other.id !== account.id &&
          normalize(other.name) !== normalize(account.name) &&
          contains(other.name, account.name)
      )
  );
  const remaining = specific.reduce(
    (value, account) => value.replace(normalize(account.name), ' '),
    normalize(source)
  );
  return [
    ...specific,
    ...accounts.filter((account) => {
      if (specific.some((match) => match.id === account.id)) return false;
      const name = normalize(account.name);
      const distinctive = name
        .split(' ')
        .filter(
          (token) =>
            token.length >= 3 &&
            ![
              'account',
              'bank',
              'checking',
              'savings',
              'wallet',
              'card',
              'credit',
              'debit'
            ].includes(token)
        );
      const subtype = normalize(account.subtype);
      // A named but unknown bank must not resolve to the only generic bank account.
      const genericOnly = !remaining
        .split(/\s+/)
        .some(
          (token) =>
            token &&
            !/^(?:my|the|a|an|account|bank|checking|savings|cash|e|wallet|debit|card|php|usd|pesos?|today|yesterday|\d+[km]?)$/.test(
              token
            )
        );
      const conflictingType = ['checking', 'savings'].some(
        (type) => contains(remaining, type) && subtype !== type && !contains(name, type)
      );
      const alias = distinctive.join(' ');
      const aliasRemainder = normalize(
        remaining.split(/\b(?:for|memo|note)\b/)[0].replace(alias, ' ')
      );
      const aliasHasUnknownQualifier = aliasRemainder
        .split(/\s+/)
        .some(
          (token) =>
            token &&
            !transferWords.test(token) &&
            !/^(?:my|the|a|an|from|to|and|or|account|bank|checking|savings|cash|e|wallet|debit|card|php|usd|pesos?|today|yesterday|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|\d+[km]?)$/.test(
              token
            )
        );
      return (
        !conflictingType &&
        ((contains(remaining, alias) && !aliasHasUnknownQualifier) ||
          (genericOnly &&
            ((contains(remaining, 'bank') &&
              ['bank', 'checking', 'savings', 'debit'].includes(subtype)) ||
              (contains(remaining, 'cash') && subtype === 'cash') ||
              (contains(remaining, 'checking') && subtype === 'checking') ||
              (contains(remaining, 'savings') && subtype === 'savings') ||
              (contains(remaining, 'wallet') &&
                ['wallet', 'e wallet', 'ewallet'].includes(subtype)))))
      );
    })
  ];
}

export function parseNotesTransfer(source, accounts) {
  const text = String(source || '');
  const arrows = [...text.matchAll(/->|=>|→|<-|<=|←/g)];
  const wordIntent = hasNotesTransferWords(text);
  const mentionedAccounts = matchNotesAccounts(text, accounts);
  const salaryDeposit =
    /\bdeposit(?:ed)?\b/i.test(text) &&
    /\b(?:salary|paycheck|payroll|wages|income)\b/i.test(text) &&
    mentionedAccounts.length < 2 &&
    !/\b(?:from|frm|form)\b/i.test(text);
  if (salaryDeposit) return null;
  const accountDirection = /\b(?:from|to|into)\b/i.test(text) && mentionedAccounts.length >= 2;
  if (!wordIntent && !accountDirection && !(arrows.length && mentionedAccounts.length)) return null;
  const issues = [];
  let from = '';
  let to = '';
  let directionAmbiguous = false;
  if (arrows.length === 1) {
    const arrow = arrows[0];
    const left = text.slice(0, arrow.index);
    const right = text.slice(arrow.index + arrow[0].length);
    [from, to] = ['<-', '<=', '←'].includes(arrow[0]) ? [right, left] : [left, right];
    // Mixing directions/clauses can describe a correction, not a single transfer.
    directionAmbiguous = /\b(?:from|to|into|between)\b/i.test(text);
  } else if (arrows.length > 1 || /\bbetween\b/i.test(text)) {
    directionAmbiguous = true;
  } else {
    const markers = [...text.matchAll(/\b(from|form|frm|fm|out\s+of|to|into)\b/gi)];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const segment = text.slice(
        marker.index + marker[0].length,
        markers[index + 1]?.index ?? text.length
      );
      if (/^(?:from|form|frm|fm|out\s+of)$/i.test(marker[0])) {
        if (from) directionAmbiguous = true;
        from = segment;
      } else {
        if (to) directionAmbiguous = true;
        to = segment;
      }
    }
    if (markers.length === 1) {
      const before = text.slice(0, markers[0].index);
      if (to) from = before;
      else if (/\b(?:withdraw|withdrew|withdrawn|cash(?:ed)?\s+out|deposit(?:ed)?)\b/i.test(text))
        to = before;
    }
  }
  const directionText = [from, to]
    .map((segment) => segment.split(/\b(?:for|memo|note)\b/i)[0])
    .join(' ');
  if (/\b(?:or|and)\b/i.test(directionText)) directionAmbiguous = true;
  const sourceMatches = matchNotesAccounts(from, accounts);
  const destinationMatches = matchNotesAccounts(to, accounts);
  if (directionAmbiguous)
    issues.push({
      code: 'transfer_direction_review',
      field: 'review',
      message: 'Choose the source and destination; the transfer direction is unclear.'
    });
  for (const [matches, field, label] of [
    [sourceMatches, 'primaryAccountId', 'source'],
    [destinationMatches, 'secondaryAccountId', 'destination']
  ]) {
    if (matches.length > 1)
      issues.push({
        code: 'transfer_account_ambiguous',
        field,
        message: `More than one account matches the transfer ${label}. Choose the account.`
      });
  }
  if (/\b(?:tranfer(?:red|ed)?|tranfser|transfr|trnsfer|transferr|form|frm|fm)\b/i.test(text))
    issues.push({
      code: 'transfer_spelling_review',
      field: 'review',
      message: 'Check the transfer details; the note contains a spelling shortcut or error.'
    });
  if (
    /\b(?:did\s*not|(?:did|was|were|have|has|had|could|would|ca|wo)n['’]?t|don['’]?t|do\s+not|not|never|cannot|failed|declined|rejected|unsuccessful|cancel(?:led|ed)?|will|gonna|going\s+to|might|should|would|want\s+to|need\s+to|plan(?:ned)?|pending|scheduled|later|soon)\b/i.test(
      text
    )
  )
    issues.push({
      code: 'transaction_intent_review',
      field: 'review',
      message:
        'Check whether this transfer happened; incomplete, cancelled and planned transfers should stay in your notes.'
    });
  return {
    primaryAccountId:
      !directionAmbiguous && sourceMatches.length === 1 ? String(sourceMatches[0].id) : '',
    secondaryAccountId:
      !directionAmbiguous && destinationMatches.length === 1
        ? String(destinationMatches[0].id)
        : '',
    issues
  };
}
