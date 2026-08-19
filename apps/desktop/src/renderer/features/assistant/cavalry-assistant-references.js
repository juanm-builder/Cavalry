const REFERENCE_KINDS = Object.freeze([
  'account',
  'transaction',
  'category',
  'budget',
  'sheet',
  'recurringItem',
  'evidence'
]);

const SOURCE_PREFIX_BY_KIND = Object.freeze({
  account: 'account:',
  transaction: 'transaction:',
  category: 'category:',
  budget: 'budget:',
  sheet: 'sheet:',
  recurringItem: 'recurringItem:'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function stableId(value) {
  const id = asText(value);
  return id && !/[\u0000-\u001f\u007f]/.test(id) ? id : '';
}

function copyPlainObject(value) {
  const source = asObject(value);
  try {
    const copy = JSON.parse(JSON.stringify(source));
    return asObject(copy);
  } catch (_error) {
    return {};
  }
}

function uniqueText(values) {
  const seen = new Set();
  const items = [];
  asArray(values).forEach((value) => {
    const item = asText(value);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });
  return items;
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function finiteNumber(source, key) {
  if (!hasOwn(source, key) || source[key] === '' || source[key] == null) return undefined;
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : undefined;
}

function detailObject(entries) {
  return Object.fromEntries(
    entries.filter(([, value]) => value !== '' && value !== null && typeof value !== 'undefined')
  );
}

function sourceRefFor(kind, id, secondaryId = '') {
  const primaryId = stableId(id);
  const secondaryIdValue = stableId(secondaryId);
  const primary = primaryId ? encodeURIComponent(primaryId) : '';
  const secondary = secondaryIdValue ? encodeURIComponent(secondaryIdValue) : '';
  if (!primary || (kind === 'budget' && !secondary)) return '';
  const prefix = SOURCE_PREFIX_BY_KIND[kind];
  if (!prefix) return '';
  return kind === 'budget' ? `${prefix}${primary}:${secondary}` : `${prefix}${primary}`;
}

function makeCandidate({ kind, entityId, secondaryId, label, aliases, detail }) {
  const sourceRef = sourceRefFor(kind, entityId, secondaryId);
  if (!sourceRef) return null;
  const normalizedLabel = asText(label) || stableId(secondaryId) || stableId(entityId);
  if (!normalizedLabel) return null;
  return {
    id: sourceRef,
    label: normalizedLabel,
    kind,
    source_refs: [sourceRef],
    aliases: uniqueText([...(aliases || []), normalizedLabel, secondaryId, entityId, sourceRef]),
    detail: copyPlainObject(detail)
  };
}

function accountCandidate(value) {
  const source = asObject(value);
  const id = stableId(source.id || source.accountId);
  const label = asText(source.name || source.accountName || source.label) || id;
  if (!id || !label) return null;
  return makeCandidate({
    kind: 'account',
    entityId: id,
    label,
    aliases: [`${label} account`, label],
    detail: detailObject([
      ['accountId', id],
      ['group', asText(source.group)],
      ['subtype', asText(source.subtype)],
      ['balance', finiteNumber(source, 'balance')],
      ['currency', asText(source.currency)],
      ['baseBalance', finiteNumber(source, 'baseBalance')],
      ['baseCurrency', asText(source.baseCurrency)],
      ['institution', asText(source.institution)],
      ['isActive', typeof source.isActive === 'boolean' ? source.isActive : undefined]
    ])
  });
}

function transactionCandidate(value) {
  const source = asObject(value);
  const id = stableId(source.id || source.transactionId);
  const label = asText(source.description || source.name || source.reference) || id;
  if (!id || !label) return null;
  return makeCandidate({
    kind: 'transaction',
    entityId: id,
    label,
    aliases: [`${label} transaction`, label],
    detail: detailObject([
      ['transactionId', id],
      ['date', asText(source.date)],
      ['amount', finiteNumber(source, 'amount')],
      ['currency', asText(source.currency || source.originalCurrency)],
      ['baseAmount', finiteNumber(source, 'baseAmount')],
      ['type', asText(source.type || source.template)],
      ['accountId', stableId(source.accountId)],
      ['categoryId', stableId(source.categoryId)],
      ['recurringItemId', stableId(source.recurringItemId)]
    ])
  });
}

function referenceRecord(candidate) {
  return {
    source_ref: candidate.source_refs[0],
    label: candidate.label,
    kind: candidate.kind,
    detail: copyPlainObject(candidate.detail)
  };
}

function categoryCandidate(value) {
  const source = asObject(value);
  const id = stableId(source.id || source.categoryId);
  const label = asText(source.name || source.categoryName || source.label) || id;
  if (!id || !label) return null;
  return makeCandidate({
    kind: 'category',
    entityId: id,
    label,
    aliases: [`${label} category`, label],
    detail: detailObject([
      ['categoryId', id],
      ['type', asText(source.type || source.categoryType)],
      ['description', asText(source.description)],
      ['icon', asText(source.icon)],
      ['color', asText(source.color)],
      ['isActive', typeof source.isActive === 'boolean' ? source.isActive : undefined]
    ])
  });
}

function recurringItemCandidate(value) {
  const source = asObject(value);
  const id = stableId(source.id || source.recurringItemId);
  const label = asText(source.name || source.recurringItemName || source.label) || id;
  const recurringKind = asText(source.kind);
  if (!id || !label) return null;
  return makeCandidate({
    kind: 'recurringItem',
    entityId: id,
    label,
    aliases: [
      recurringKind ? `${label} ${recurringKind}` : '',
      `${label} bill`,
      `${label} subscription`,
      label
    ],
    detail: detailObject([
      ['recurringItemId', id],
      ['kind', recurringKind],
      ['frequency', asText(source.frequency)],
      ['amount', finiteNumber(source, 'amount')],
      ['currency', asText(source.currency)],
      ['dueDate', asText(source.dueDate || source.anchorDate)],
      ['accountId', stableId(source.accountId)],
      ['categoryId', stableId(source.categoryId)],
      ['isActive', typeof source.isActive === 'boolean' ? source.isActive : undefined]
    ])
  });
}

function sheetCandidate(value, inherited = {}) {
  const source = asObject(value);
  const context = asObject(inherited);
  const id = stableId(source.id || source.sheetId || context.sheetId);
  const label = asText(source.name || source.sheetName || context.sheetName) || id;
  if (!id || !label) return null;
  const monthIndex = finiteNumber(source, 'monthIndex') ?? finiteNumber(context, 'monthIndex');
  const totals = copyPlainObject(source.totals || context.totals);
  return makeCandidate({
    kind: 'sheet',
    entityId: id,
    label,
    aliases: [`${label} budget sheet`, `${label} budget`, label],
    detail: detailObject([
      ['sheetId', id],
      ['sheetName', label],
      ['monthKey', asText(source.monthKey || context.monthKey)],
      ['monthIndex', monthIndex],
      ['currency', asText(source.currency || context.currency)],
      ['totals', Object.keys(totals).length ? totals : undefined]
    ])
  });
}

function budgetRowCandidate(value, inherited = {}) {
  const source = asObject(value);
  const context = asObject(inherited);
  const planned = finiteNumber(source, 'planned');
  if (source.archived === true || source.isMissing === true || !(planned > 0)) return null;
  const sheet = asObject(source.sheet);
  const sheetId = stableId(source.sheetId || sheet.id || context.sheetId);
  const categoryId = stableId(source.categoryId || source.id);
  const categoryName =
    asText(
      source.categoryName ||
        source.categoryLabel ||
        source.name ||
        source.label ||
        context.categoryName
    ) || categoryId;
  if (!sheetId || !categoryId || !categoryName) return null;
  const sheetName = asText(source.sheetName || sheet.name || context.sheetName);
  const monthIndex = finiteNumber(sheet, 'monthIndex') ?? finiteNumber(context, 'monthIndex');
  const monthKey = asText(source.monthKey || context.monthKey);
  const currency = asText(source.currency || context.currency);
  return makeCandidate({
    kind: 'budget',
    entityId: sheetId,
    secondaryId: categoryId,
    label: categoryName,
    aliases: [
      sheetName ? `${sheetName} ${categoryName} budget` : '',
      `${categoryName} budget`,
      categoryName
    ],
    detail: detailObject([
      ['sheetId', sheetId],
      ['sheetName', sheetName],
      ['monthKey', monthKey],
      ['monthIndex', monthIndex],
      ['categoryId', categoryId],
      ['categoryName', categoryName],
      ['planned', planned],
      ['actual', finiteNumber(source, 'actual')],
      ['remaining', finiteNumber(source, 'remaining')],
      ['currency', currency],
      ['archived', typeof source.archived === 'boolean' ? source.archived : undefined]
    ])
  });
}

function addCandidate(candidates, candidate) {
  if (!candidate) return;
  const key = `${candidate.kind}\u0000${candidate.source_refs[0]}`;
  const previous = candidates.get(key);
  if (!previous) {
    candidates.set(key, candidate);
    return;
  }
  candidates.set(key, {
    ...previous,
    label: candidate.label || previous.label,
    aliases: uniqueText([...candidate.aliases, ...previous.aliases]),
    detail: { ...previous.detail, ...candidate.detail }
  });
}

function addEntityShapes(candidates, data, singularKey, pluralKey, factory) {
  const singular = asObject(data[singularKey]);
  if (Object.keys(singular).length) addCandidate(candidates, factory(singular));
  asArray(data[pluralKey]).forEach((item) => addCandidate(candidates, factory(item)));
}

function addRelatedCandidates(candidates, value) {
  const source = asObject(value);
  addCandidate(
    candidates,
    accountCandidate({ id: source.accountId, name: source.accountName || source.accountLabel })
  );
  addCandidate(
    candidates,
    categoryCandidate({
      id: source.categoryId,
      name: source.categoryName || source.categoryLabel,
      type: source.categoryType
    })
  );
  asArray(source.lines).forEach((line) => {
    addCandidate(
      candidates,
      accountCandidate({ id: line?.accountId, name: line?.accountName || line?.accountLabel })
    );
  });
}

function addRelatedEntityShapes(candidates, data, singularKey, pluralKey) {
  const singular = asObject(data[singularKey]);
  if (Object.keys(singular).length) addRelatedCandidates(candidates, singular);
  asArray(data[pluralKey]).forEach((item) => addRelatedCandidates(candidates, item));
}

function addBudgetShape(candidates, value, hints = {}) {
  const source = asObject(value);
  const hintSource = asObject(hints);
  if (!Object.keys(source).length) return;
  const sheet = asObject(source.sheet);
  const context = {
    sheetId: stableId(source.sheetId || sheet.id),
    sheetName: asText(source.sheetName || sheet.name || hintSource.sheetName),
    categoryName: asText(hintSource.categoryName),
    monthKey: asText(source.monthKey || hintSource.monthKey),
    monthIndex: finiteNumber(source, 'monthIndex') ?? finiteNumber(sheet, 'monthIndex'),
    currency: asText(source.currency),
    totals: copyPlainObject(source.totals)
  };
  if (context.sheetId) {
    addCandidate(
      candidates,
      sheetCandidate(
        {
          ...sheet,
          id: context.sheetId,
          name: context.sheetName,
          monthKey: context.monthKey,
          currency: context.currency,
          totals: context.totals
        },
        context
      )
    );
  }
  asArray(source.rows).forEach((row) => {
    addCandidate(candidates, budgetRowCandidate(row, context));
    if (row?.isMissing !== true) {
      addCandidate(
        candidates,
        categoryCandidate({
          id: row?.categoryId,
          name: row?.categoryName,
          type: row?.categoryType
        })
      );
    }
  });
  if (stableId(source.categoryId)) {
    addCandidate(candidates, budgetRowCandidate(source, context));
    addCandidate(
      candidates,
      categoryCandidate({
        id: source.categoryId,
        name: source.categoryName || context.categoryName,
        type: source.categoryType
      })
    );
  }
}

function addEvidenceRecordCandidates(candidates, evidenceSet) {
  const source = asObject(evidenceSet);
  const kind = asText(source.kind);
  asArray(source.records).forEach((record) => {
    if (kind === 'account') addCandidate(candidates, accountCandidate(record));
    else if (kind === 'category') addCandidate(candidates, categoryCandidate(record));
    else if (kind === 'recurringItem') addCandidate(candidates, recurringItemCandidate(record));
    else addCandidate(candidates, transactionCandidate(record));
  });
}

function addEvidenceSet(candidates, evidenceSets, evidenceSet) {
  const source = asObject(evidenceSet);
  const id = stableId(source.id);
  if (!id) return;
  addEvidenceRecordCandidates(candidates, source);
  const previous = evidenceSets.get(id) || {};
  const sourceRefs = uniqueText(source.source_refs || source.sourceRefs);
  evidenceSets.set(id, {
    id,
    label: asText(source.label) || previous.label || 'Supporting records',
    kind: asText(source.kind) || previous.kind || '',
    source_refs: sourceRefs.length ? sourceRefs : asArray(previous.source_refs),
    calculation: {
      ...copyPlainObject(previous.calculation),
      ...copyPlainObject(source.calculation)
    },
    inference: {
      ...copyPlainObject(previous.inference),
      ...copyPlainObject(source.inference)
    }
  });
}

function collectReferenceRegistry(toolResults) {
  const candidates = new Map();
  const evidenceSets = new Map();
  asArray(toolResults).forEach((toolResult) => {
    const source = asObject(toolResult);
    const result = asObject(source.result);
    const data = asObject(result.data);
    if (source.ok !== true || result.ok !== true || !Object.keys(data).length) return;
    addEntityShapes(candidates, data, 'account', 'accounts', accountCandidate);
    addEntityShapes(candidates, data, 'transaction', 'transactions', transactionCandidate);
    addEntityShapes(candidates, data, 'category', 'categories', categoryCandidate);
    addEntityShapes(candidates, data, 'recurringItem', 'recurringItems', recurringItemCandidate);
    addRelatedEntityShapes(candidates, data, 'transaction', 'transactions');
    addRelatedEntityShapes(candidates, data, 'recurringItem', 'recurringItems');
    asArray(data.recurringCandidates).forEach((candidate) => {
      asArray(candidate?.transactions).forEach((transaction) =>
        addCandidate(candidates, transactionCandidate(transaction))
      );
    });
    const budget = asObject(data.budget);
    const argumentsValue = asObject(source.arguments);
    if (Object.keys(budget).length) {
      addBudgetShape(candidates, budget, {
        sheetName: asText(argumentsValue.sheet),
        categoryName: asText(argumentsValue.category),
        monthKey: asText(argumentsValue.month)
      });
    }
    asArray(data.budgets).forEach((item) => addBudgetShape(candidates, item));
    asArray(data.evidenceSets).forEach((evidenceSet) =>
      addEvidenceSet(candidates, evidenceSets, evidenceSet)
    );
    asArray(result.referenceData?.evidenceSets).forEach((evidenceSet) =>
      addEvidenceSet(candidates, evidenceSets, evidenceSet)
    );
  });
  return { candidates: [...candidates.values()], evidenceSets };
}

function transactionAmountAliases(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return [];
  const formatted = amount.toLocaleString('en-US', { maximumFractionDigits: 20 });
  return uniqueText([String(amount), formatted, `₱${formatted}`, `PHP ${formatted}`]);
}

function specificallyMatchedTransaction(text, candidate, group) {
  const date = asText(candidate.detail.date);
  if (date && findAlias(text, date)) return true;
  const amount = Number(candidate.detail.amount);
  if (!Number.isFinite(amount)) return false;
  const sameAmountCount = group.filter((item) => Number(item.detail.amount) === amount).length;
  return (
    sameAmountCount === 1 &&
    transactionAmountAliases(amount).some((alias) => Boolean(findAlias(text, alias)))
  );
}

function groupRepeatedTransactionCandidates(candidates, text = '') {
  const transactionGroups = new Map();
  const output = [];
  asArray(candidates).forEach((candidate) => {
    if (candidate.kind !== 'transaction') {
      output.push(candidate);
      return;
    }
    const key = candidate.label.toLocaleLowerCase();
    const group = transactionGroups.get(key) || [];
    group.push(candidate);
    transactionGroups.set(key, group);
  });
  transactionGroups.forEach((group) => {
    if (group.length === 1) {
      output.push(group[0]);
      return;
    }
    const specificMatches = group.filter((candidate) =>
      specificallyMatchedTransaction(text, candidate, group)
    );
    if (specificMatches.length === 1) {
      output.push(specificMatches[0]);
      return;
    }
    const dates = group
      .map((candidate) => asText(candidate.detail.date))
      .filter(Boolean)
      .sort();
    const records = group.map(referenceRecord);
    output.push({
      id: `transaction-group:${group.map((candidate) => candidate.source_refs[0]).join('|')}`,
      label: group[0].label,
      kind: 'transaction',
      source_refs: uniqueText(group.flatMap((candidate) => candidate.source_refs)),
      aliases: uniqueText(group.flatMap((candidate) => candidate.aliases)),
      detail: detailObject([
        ['transactionCount', group.length],
        ['firstDate', dates[0]],
        ['lastDate', dates.at(-1)],
        ['records', records]
      ])
    });
  });
  return output;
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

function findAlias(text, alias) {
  const value = asText(alias);
  if (!value) return null;
  const pattern = value.split(/\s+/).map(regexEscape).join('\\s+');
  let matcher;
  try {
    matcher = new RegExp(pattern, 'giu');
  } catch (_error) {
    return null;
  }
  const first = value[0];
  const last = value[value.length - 1];
  let match = matcher.exec(text);
  while (match) {
    const before = match.index > 0 ? text[match.index - 1] : '';
    const afterIndex = match.index + match[0].length;
    const after = afterIndex < text.length ? text[afterIndex] : '';
    if (
      (!isWordCharacter(first) || !isWordCharacter(before)) &&
      (!isWordCharacter(last) || !isWordCharacter(after))
    ) {
      return { token: match[0], index: match.index, aliasLength: value.length };
    }
    if (match[0] === '') matcher.lastIndex += 1;
    match = matcher.exec(text);
  }
  return null;
}

const EXPLICIT_KIND_WORDS = Object.freeze({
  account: new Set(['account']),
  transaction: new Set(['transaction']),
  category: new Set(['category']),
  budget: new Set(['budget']),
  sheet: new Set(['budget']),
  recurringItem: new Set(['bill', 'subscription'])
});

function hasConflictingKindSuffix(text, match, kind) {
  const suffix = text.slice(match.index + match.token.length);
  const explicitKind = /^\s+(account|transaction|category|budget|bill|subscription)\b/iu.exec(
    suffix
  )?.[1];
  if (!explicitKind) return false;
  return !EXPLICIT_KIND_WORDS[kind]?.has(explicitKind.toLocaleLowerCase());
}

function candidateMatch(text, candidate) {
  return candidate.aliases
    .map((alias, aliasIndex) => {
      const match = findAlias(text, alias);
      return match && !hasConflictingKindSuffix(text, match, candidate.kind)
        ? { ...match, aliasIndex }
        : null;
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.aliasLength - left.aliasLength ||
        left.index - right.index ||
        left.aliasIndex - right.aliasIndex
    )[0];
}

function validSourceRef(kind, sourceRef) {
  const value = asText(sourceRef);
  const prefix = SOURCE_PREFIX_BY_KIND[kind];
  if (!prefix || !value.startsWith(prefix) || value.length <= prefix.length) return false;
  const remainder = value.slice(prefix.length);
  const parts = kind === 'budget' ? remainder.split(':') : [remainder];
  if (parts.length !== (kind === 'budget' ? 2 : 1) || parts.some((part) => !part)) return false;
  try {
    return parts.every((part) => Boolean(stableId(decodeURIComponent(part))));
  } catch (_error) {
    return false;
  }
}

function kindFromSourceRefs(sourceRefs) {
  for (const sourceRef of sourceRefs) {
    const kind = REFERENCE_KINDS.find((candidateKind) => validSourceRef(candidateKind, sourceRef));
    if (kind) return kind;
  }
  return '';
}

export function normalizeCavalryAssistantReferences(value) {
  return asArray(value)
    .map((reference) => {
      const source = asObject(reference);
      const suppliedSourceRefs = uniqueText(source.source_refs || source.sourceRefs);
      const suppliedKind = asText(source.kind);
      if (suppliedKind && !REFERENCE_KINDS.includes(suppliedKind)) return null;
      let entries = suppliedSourceRefs
        .map((sourceRef) => {
          const kind = kindFromSourceRefs([sourceRef]);
          return validSourceRef(kind, sourceRef) ? { kind, sourceRef } : null;
        })
        .filter(Boolean);
      if (suppliedKind && suppliedKind !== 'evidence') {
        entries = entries.filter((entry) => entry.kind === suppliedKind);
      }
      const token = asText(source.token);
      if (!token || !entries.length) return null;
      const entryKinds = uniqueText(entries.map((entry) => entry.kind));
      const kind =
        suppliedKind ||
        (entryKinds.length === 1 ? entryKinds[0] : entryKinds.length ? 'evidence' : '');
      if (!kind) return null;
      const label = asText(source.label) || token;
      const sourceRefs = entries.map((entry) => entry.sourceRef);
      const anchor = /^#cavalry-source-[a-z0-9_-]+$/i.test(asText(source.anchor))
        ? asText(source.anchor)
        : '';
      return {
        id: asText(source.id) || (sourceRefs.length === 1 ? sourceRefs[0] : sourceRefs.join('|')),
        token,
        aliases: uniqueText([...asArray(source.aliases), label]),
        label,
        kind,
        source_refs: sourceRefs,
        detail: copyPlainObject(source.detail),
        ...(anchor ? { anchor } : {}),
        ...(asText(source.support) ? { support: asText(source.support) } : {})
      };
    })
    .filter(Boolean);
}

function candidateBySourceRef(candidates) {
  return new Map(
    asArray(candidates).flatMap((candidate) =>
      asArray(candidate.source_refs).map((sourceRef) => [sourceRef, candidate])
    )
  );
}

function canonicalSourceRef(value, bySourceRef) {
  const supplied = asText(value);
  if (!supplied) return '';
  if (bySourceRef.has(supplied)) return supplied;
  const caseInsensitive = [...bySourceRef.keys()].filter(
    (sourceRef) => sourceRef.toLocaleLowerCase() === supplied.toLocaleLowerCase()
  );
  if (caseInsensitive.length === 1) return caseInsensitive[0];
  const separator = supplied.indexOf(':');
  if (separator < 1) return '';
  const kind = supplied.slice(0, separator);
  const rawId = supplied.slice(separator + 1);
  if (!REFERENCE_KINDS.includes(kind) || kind === 'evidence' || !rawId) return '';
  let generated = '';
  if (kind === 'budget') {
    const budgetParts = rawId.includes('/') ? rawId.split('/') : rawId.split(':');
    if (budgetParts.length === 2) generated = sourceRefFor(kind, budgetParts[0], budgetParts[1]);
  } else {
    generated = sourceRefFor(kind, rawId);
  }
  return generated && bySourceRef.has(generated) ? generated : '';
}

function canonicalEvidenceSourceRef(value) {
  const supplied = asText(value);
  const kind = kindFromSourceRefs([supplied]);
  return kind && validSourceRef(kind, supplied) ? supplied : '';
}

function sourceKinds(sourceRefs) {
  return uniqueText(asArray(sourceRefs).map((sourceRef) => kindFromSourceRefs([sourceRef])));
}

function groupedReference({ index, label, sourceRefs, candidates, calculation, inference }) {
  const uniqueSourceRefs = uniqueText(sourceRefs);
  const records = uniqueSourceRefs
    .map((sourceRef) => {
      const candidate = candidates.get(sourceRef);
      return candidate ? referenceRecord(candidate) : null;
    })
    .filter(Boolean);
  const kinds = sourceKinds(sourceRefs);
  return {
    id: `cavalry-citation-${index}`,
    anchor: `#cavalry-source-${index}`,
    token: 'source',
    aliases: [],
    label: asText(label) || (records.length === 1 ? records[0].label : 'Supporting records'),
    kind: kinds.length === 1 ? kinds[0] : 'evidence',
    source_refs: uniqueSourceRefs,
    support: Object.keys(asObject(calculation)).length
      ? 'calculated'
      : Object.keys(asObject(inference)).length
        ? 'inferred'
        : 'recorded',
    detail: detailObject([
      ['sourceCount', uniqueSourceRefs.length],
      ['records', records],
      ['calculation', copyPlainObject(calculation)],
      ['inference', copyPlainObject(inference)]
    ])
  };
}

const INVALID_CITATION_PATTERN = /\[\[cavalry-invalid-citation-(\d+)\]\]/i;
const MONTH_INDEX = Object.freeze({
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
});
const MONTH_WORD = Object.keys(MONTH_INDEX).join('|');

function claimStartBeforeMarker(text, markerStart) {
  let claimEnd = markerStart;
  while (claimEnd > 0 && /[ \t]/.test(text[claimEnd - 1])) claimEnd -= 1;
  let searchEnd = claimEnd;
  while (searchEnd > 0 && /["')\]]/.test(text[searchEnd - 1])) searchEnd -= 1;
  if (searchEnd > 0 && /[.!?]/.test(text[searchEnd - 1])) searchEnd -= 1;
  const prefix = text.slice(0, searchEnd);
  const boundary = /[.!?](?:["')\]]*)\s+|[;\n|]/g;
  let start = 0;
  let match = boundary.exec(prefix);
  while (match) {
    start = match.index + match[0].length;
    match = boundary.exec(prefix);
  }
  return start;
}

function claimEndAfterMarker(text, markerEnd) {
  let cursor = markerEnd;
  while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;
  if (!/[.!?]/.test(text[cursor] || '')) return markerEnd;
  cursor += 1;
  while (cursor < text.length && /["')\]]/.test(text[cursor])) cursor += 1;
  while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;
  return cursor;
}

function cleanClaimText(value) {
  return asText(value)
    .replace(/^(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/\[\[(?:source|source-set):[^\]\n]+\]\]/gi, '')
    .replace(/[*_~`]+/g, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function verificationFailure(claim, includeClaim) {
  const cleanClaim = cleanClaimText(claim);
  if (includeClaim && cleanClaim && cleanClaim.length <= 180) {
    return `I couldn't verify “${cleanClaim}” from the workbook.`;
  }
  return "I couldn't verify that from the workbook.";
}

function replaceInvalidCitationClaims(text, { includeClaim = true } = {}) {
  let output = text;
  let match = INVALID_CITATION_PATTERN.exec(output);
  while (match) {
    const start = claimStartBeforeMarker(output, match.index);
    const end = claimEndAfterMarker(output, match.index + match[0].length);
    const removed = output.slice(start, match.index);
    const structure = /^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)/.exec(removed)?.[1] || '';
    const replacement = `${structure}${verificationFailure(removed, includeClaim)}`;
    const suffix = output.slice(end);
    const separator = suffix && !/^[\s|]/.test(suffix) ? ' ' : '';
    output = `${output.slice(0, start)}${replacement}${separator}${suffix}`;
    match = INVALID_CITATION_PATTERN.exec(output);
  }
  return output;
}

function evidenceDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asText(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return Number.isInteger(year) && month >= 0 && month <= 11 ? { year, month } : null;
}

function evidenceDates(sourceRefs, candidates, inference) {
  return uniqueText([
    ...asArray(sourceRefs).map((sourceRef) => asText(candidates.get(sourceRef)?.detail?.date)),
    asText(inference?.firstSeenDate),
    asText(inference?.lastSeenDate)
  ])
    .map(evidenceDate)
    .filter(Boolean);
}

function dateRangeSupportedByEvidence(claim, sourceRefs, candidates, inference) {
  const range = new RegExp(
    `\\b(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?\\s+(?:through|to|until|[-–—])\\s+(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`,
    'i'
  ).exec(claim);
  if (!range) return true;
  const dates = evidenceDates(sourceRefs, candidates, inference);
  if (!dates.length) return false;
  const years = uniqueText(dates.map((date) => date.year));
  if (years.length !== 1 && (!range[2] || !range[4])) return true;
  const defaultYear = Number(years[0]);
  const startYear = Number(range[2] || defaultYear);
  const endYear = Number(range[4] || defaultYear);
  const start = startYear * 12 + MONTH_INDEX[range[1].toLocaleLowerCase()];
  const end = endYear * 12 + MONTH_INDEX[range[3].toLocaleLowerCase()];
  const ordinals = dates.map((date) => date.year * 12 + date.month);
  return Math.min(...ordinals) <= start && Math.max(...ordinals) >= end;
}

function absenceAfterMonthSupported(claim, sourceRefs, candidates, inference) {
  const absence = new RegExp(
    `\\b(?:no|not|didn't|did not|haven't|have not)\\b[^.!?]*\\b(?:charge|charges|payment|payments|transaction|transactions)\\b[^.!?]*\\bafter\\s+(${MONTH_WORD})(?:\\s+(\\d{4}))?\\b`,
    'i'
  ).exec(claim);
  if (!absence) return true;
  const observedThrough = evidenceDate(inference?.asOfDate);
  const dates = evidenceDates(sourceRefs, candidates, inference);
  if (!observedThrough || !dates.length) return false;
  const defaultYear = Number(absence[2] || observedThrough.year);
  const cutoff = defaultYear * 12 + MONTH_INDEX[absence[1].toLocaleLowerCase()];
  const lastSeen = Math.max(...dates.map((date) => date.year * 12 + date.month));
  const observationEnd = observedThrough.year * 12 + observedThrough.month;
  return lastSeen <= cutoff && observationEnd > cutoff;
}

function explicitCitations(text, registry) {
  const bySourceRef = candidateBySourceRef(registry.candidates);
  const references = [];
  let markerCount = 0;
  let invalidCount = 0;
  const markedText = text.replace(
    /\[\[(source|source-set):([^\]\n]+)\]\]/gi,
    (_marker, markerType, rawValues, markerOffset) => {
      markerCount += 1;
      const rawParts = rawValues.split('|');
      const values = rawParts.map((value) => value.trim()).filter(Boolean);
      let label = '';
      let calculation = {};
      let inference = {};
      let sourceRefs = [];
      let valid = values.length > 0 && rawParts.every((value) => Boolean(value.trim()));
      if (markerType.toLocaleLowerCase() === 'source-set') {
        values.forEach((value) => {
          const evidenceSet = registry.evidenceSets.get(value);
          if (!evidenceSet) {
            valid = false;
            return;
          }
          label ||= evidenceSet.label;
          const evidenceSourceRefs = asArray(evidenceSet.source_refs);
          if (!evidenceSourceRefs.length) valid = false;
          const canonicalRefs = evidenceSourceRefs.map(canonicalEvidenceSourceRef);
          if (canonicalRefs.some((sourceRef) => !sourceRef)) valid = false;
          sourceRefs.push(...canonicalRefs);
          calculation = { ...calculation, ...evidenceSet.calculation };
          inference = { ...inference, ...evidenceSet.inference };
        });
      } else {
        sourceRefs = values.map((sourceRef) => canonicalSourceRef(sourceRef, bySourceRef));
        if (sourceRefs.some((sourceRef) => !sourceRef)) valid = false;
      }
      sourceRefs = uniqueText(sourceRefs.filter(Boolean));
      const claimStart = claimStartBeforeMarker(text, markerOffset);
      const claim = text.slice(claimStart, markerOffset);
      const calculationBacked = Object.keys(asObject(calculation)).length > 0;
      if (
        !sourceRefs.length ||
        (!calculationBacked &&
          !dateRangeSupportedByEvidence(claim, sourceRefs, bySourceRef, inference)) ||
        !absenceAfterMonthSupported(claim, sourceRefs, bySourceRef, inference)
      ) {
        valid = false;
      }
      if (!valid) {
        invalidCount += 1;
        return `[[cavalry-invalid-citation-${invalidCount}]]`;
      }
      const index = references.length + 1;
      references.push(
        groupedReference({
          index,
          label,
          sourceRefs,
          candidates: bySourceRef,
          calculation,
          inference
        })
      );
      return `[source](#cavalry-source-${index})`;
    }
  );
  return {
    text: replaceInvalidCitationClaims(markedText),
    fallbackText: replaceInvalidCitationClaims(markedText, { includeClaim: false }),
    references,
    markerCount
  };
}

function claimContainingMatch(text, match) {
  const before = text.slice(0, match.index);
  const afterIndex = match.index + match.token.length;
  const startBoundary = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf('?'),
    before.lastIndexOf('!'),
    before.lastIndexOf('\n'),
    before.lastIndexOf('|')
  );
  const remaining = text.slice(afterIndex);
  const relativeEnds = ['.', '?', '!', '\n', '|']
    .map((boundary) => remaining.indexOf(boundary))
    .filter((index) => index >= 0);
  const end = relativeEnds.length ? afterIndex + Math.min(...relativeEnds) : text.length;
  return text.slice(startBoundary + 1, end);
}

function opinionOnlyClaim(text, match) {
  const claim = claimContainingMatch(text, match);
  const recommendation =
    /\b(?:i(?:'d| would)|you(?:'d| would| should)?|we(?:'d| would| should)?)\s+(?:still\s+)?(?:keep|cut|cancel|drop|retain|remove|use)\b|\b(?:recommend|suggest)\s+(?:keeping|cutting|cancelling|dropping|retaining|removing|using)\b/i;
  if (!recommendation.test(claim)) return false;
  return !/(?:₱|\bPHP\b|\b\d+(?:[,.]\d+)*\b|\b(?:active|inactive|monthly|weekly|yearly|recurring|charged|paid|spent|received|balance|due|recorded|transaction|account|budget|subscription|bill)\b)/i.test(
    claim
  );
}

function fallbackReferences(text, candidates) {
  return groupRepeatedTransactionCandidates(candidates, text)
    .map((candidate) => {
      const match = candidateMatch(text, candidate);
      if (!match || opinionOnlyClaim(text, match)) return null;
      return {
        id: candidate.id,
        token: match.token,
        aliases: candidate.aliases,
        label: candidate.label,
        kind: candidate.kind,
        source_refs: candidate.source_refs,
        detail: candidate.detail
      };
    })
    .filter(Boolean);
}

export function buildCavalryAssistantCitations({ text = '', toolResults = [] } = {}) {
  const answerText = typeof text === 'string' ? text : '';
  if (!answerText) return { text: '', references: [] };
  const registry = collectReferenceRegistry(toolResults);
  const explicit = explicitCitations(answerText, registry);
  const fallback = fallbackReferences(
    explicit.markerCount ? explicit.fallbackText : answerText,
    registry.candidates
  );
  const explicitSourceSets = explicit.references.map(
    (reference) => new Set(asArray(reference.source_refs))
  );
  const additionalFallback = fallback.filter(
    (reference) =>
      !explicitSourceSets.some((sourceSet) =>
        asArray(reference.source_refs).every((sourceRef) => sourceSet.has(sourceRef))
      )
  );
  const references = [...explicit.references, ...additionalFallback];
  return {
    text: explicit.text,
    references: normalizeCavalryAssistantReferences(references)
  };
}

export function buildCavalryAssistantReferences(options = {}) {
  return buildCavalryAssistantCitations(options).references;
}
