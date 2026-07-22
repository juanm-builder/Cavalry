const INSTITUTION_TYPES = Object.freeze(['bank', 'digital_bank', 'e_wallet']);

function entry(definition) {
  return Object.freeze({
    aliases: [],
    formerNames: [],
    type: 'bank',
    active: true,
    ...definition,
    aliases: Object.freeze(definition.aliases || []),
    formerNames: Object.freeze(definition.formerNames || [])
  });
}

export const INSTITUTION_CATALOG = Object.freeze([
  entry({
    id: 'bdo',
    name: 'BDO Unibank',
    shortName: 'BDO',
    monogram: 'BDO',
    aliases: ['Banco de Oro', 'BDO Unibank Inc'],
    color: '#00308f'
  }),
  entry({
    id: 'bpi',
    name: 'Bank of the Philippine Islands',
    shortName: 'BPI',
    monogram: 'BPI',
    aliases: ['BPI Family Savings Bank'],
    color: '#a4172d'
  }),
  entry({
    id: 'metrobank',
    name: 'Metropolitan Bank and Trust Company',
    shortName: 'Metrobank',
    monogram: 'MB',
    aliases: ['MBTC'],
    color: '#00539f'
  }),
  entry({
    id: 'landbank',
    name: 'Land Bank of the Philippines',
    shortName: 'LandBank',
    monogram: 'LBP',
    aliases: ['LBP'],
    color: '#00833e'
  }),
  entry({
    id: 'chinabank',
    name: 'China Banking Corporation',
    shortName: 'Chinabank',
    monogram: 'CBC',
    aliases: ['China Bank', 'CBC', 'China Bank Savings'],
    color: '#c8102e'
  }),
  entry({
    id: 'rcbc',
    name: 'Rizal Commercial Banking Corporation',
    shortName: 'RCBC',
    monogram: 'RCBC',
    aliases: ['Rizal', 'RCBC DiskarTech', 'DiskarTech', 'RCBC Bankard', 'Bankard'],
    color: '#0067b1'
  }),
  entry({
    id: 'securitybank',
    name: 'Security Bank Corporation',
    shortName: 'Security Bank',
    monogram: 'SB',
    aliases: ['SBC'],
    color: '#00529b'
  }),
  entry({
    id: 'pnb',
    name: 'Philippine National Bank',
    shortName: 'PNB',
    monogram: 'PNB',
    aliases: [],
    color: '#005baa'
  }),
  entry({
    id: 'unionbank',
    name: 'Union Bank of the Philippines',
    shortName: 'UnionBank',
    monogram: 'UB',
    aliases: ['UBP'],
    formerNames: ['Citibank Philippines consumer banking', 'Citi'],
    color: '#f47b20'
  }),
  entry({
    id: 'dbp',
    name: 'Development Bank of the Philippines',
    shortName: 'DBP',
    monogram: 'DBP',
    aliases: [],
    color: '#00337f'
  }),
  entry({
    id: 'eastwest',
    name: 'East West Banking Corporation',
    shortName: 'EastWest',
    monogram: 'EW',
    aliases: ['EastWest Bank', 'East West Bank'],
    color: '#5c2d91'
  }),
  entry({
    id: 'aub',
    name: 'Asia United Bank',
    shortName: 'AUB',
    monogram: 'AUB',
    aliases: ['Asia United Bank Corporation', 'HelloMoney'],
    color: '#e4571f'
  }),
  entry({
    id: 'bankcom',
    name: 'Bank of Commerce',
    shortName: 'BankCom',
    monogram: 'BC',
    aliases: ['Bank of Commerce Philippines'],
    color: '#1b3f94'
  }),
  entry({
    id: 'psbank',
    name: 'Philippine Savings Bank',
    shortName: 'PSBank',
    monogram: 'PSB',
    aliases: ['PS Bank'],
    color: '#d3202f'
  }),
  entry({
    id: 'maybank',
    name: 'Maybank Philippines',
    shortName: 'Maybank',
    monogram: 'MYB',
    aliases: ['Malayan Banking Berhad Philippines'],
    color: '#b08b00'
  }),
  entry({
    id: 'cimb',
    name: 'CIMB Bank Philippines',
    shortName: 'CIMB',
    monogram: 'CIMB',
    aliases: ['CIMB Bank'],
    color: '#c0122e'
  }),
  entry({
    id: 'hsbc',
    name: 'HSBC Philippines',
    shortName: 'HSBC',
    monogram: 'HSBC',
    aliases: ['Hongkong and Shanghai Banking Corporation'],
    color: '#b31b34'
  }),
  entry({
    id: 'gotyme',
    name: 'GoTyme Bank',
    shortName: 'GoTyme',
    monogram: 'GT',
    aliases: ['GoTyme Bank Corporation'],
    type: 'digital_bank',
    color: '#008577'
  }),
  entry({
    id: 'mayabank',
    name: 'Maya Bank',
    shortName: 'Maya Bank',
    monogram: 'MYA',
    aliases: ['Maya Savings'],
    type: 'digital_bank',
    color: '#087443'
  }),
  entry({
    id: 'tonik',
    name: 'Tonik Digital Bank',
    shortName: 'Tonik',
    monogram: 'TNK',
    aliases: ['Tonik Bank'],
    type: 'digital_bank',
    color: '#6b2eb8'
  }),
  entry({
    id: 'uniondigital',
    name: 'UnionDigital Bank',
    shortName: 'UnionDigital',
    monogram: 'UD',
    aliases: ['Union Digital'],
    type: 'digital_bank',
    color: '#d95f02'
  }),
  entry({
    id: 'uno',
    name: 'UNO Digital Bank',
    shortName: 'UNO',
    monogram: 'UNO',
    aliases: ['UNObank'],
    type: 'digital_bank',
    color: '#c74a00'
  }),
  entry({
    id: 'maribank',
    name: 'MariBank Philippines',
    shortName: 'MariBank',
    monogram: 'MARI',
    aliases: [],
    formerNames: ['SeaBank', 'SeaBank Philippines'],
    type: 'digital_bank',
    color: '#d5451b'
  }),
  entry({
    id: 'gcash',
    name: 'GCash',
    shortName: 'GCash',
    monogram: 'GC',
    aliases: ['G-Xchange', 'GXI', 'Mynt'],
    type: 'e_wallet',
    color: '#0f68d8'
  }),
  entry({
    id: 'mayawallet',
    name: 'Maya Wallet',
    shortName: 'Maya',
    monogram: 'MYA',
    aliases: [],
    formerNames: ['PayMaya'],
    type: 'e_wallet',
    color: '#087443'
  }),
  entry({
    id: 'grabpay',
    name: 'GrabPay',
    shortName: 'GrabPay',
    monogram: 'GP',
    aliases: ['Grab Wallet'],
    type: 'e_wallet',
    color: '#009432'
  }),
  entry({
    id: 'shopeepay',
    name: 'ShopeePay',
    shortName: 'ShopeePay',
    monogram: 'SP',
    aliases: ['Shopee Wallet'],
    type: 'e_wallet',
    color: '#c8451f'
  }),
  entry({
    id: 'coinsph',
    name: 'Coins.ph',
    shortName: 'Coins.ph',
    monogram: 'CP',
    aliases: ['Coins PH', 'Coins Philippines'],
    type: 'e_wallet',
    color: '#0b63ce'
  }),
  entry({
    id: 'paymaya_business',
    name: 'PayMaya Business',
    shortName: 'PayMaya (Business)',
    monogram: 'PMB',
    aliases: ['Maya Business', 'PayMaya Business App'],
    type: 'e_wallet',
    color: '#f5a000'
  })
]);

const INSTITUTIONS_BY_ID = new Map(INSTITUTION_CATALOG.map((item) => [item.id, item]));

export function normalizeInstitutionText(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function institutionSearchTerms(institution) {
  return [institution.shortName, institution.name, ...institution.aliases].map(
    normalizeInstitutionText
  );
}

function institutionFormerTerms(institution) {
  return institution.formerNames.map(normalizeInstitutionText);
}

export function listInstitutionTypes() {
  return INSTITUTION_TYPES.slice();
}

export function listInstitutions(options = {}) {
  const types = Array.isArray(options.types) ? options.types : options.types ? [options.types] : [];
  return INSTITUTION_CATALOG.filter((item) => !types.length || types.includes(item.type));
}

export function findInstitutionById(id) {
  return INSTITUTIONS_BY_ID.get(String(id == null ? '' : id).trim()) || null;
}

export function resolveInstitution(text) {
  const normalized = normalizeInstitutionText(text);
  if (!normalized) {
    return null;
  }
  return (
    INSTITUTION_CATALOG.find(
      (item) =>
        institutionSearchTerms(item).includes(normalized) ||
        institutionFormerTerms(item).includes(normalized)
    ) || null
  );
}

function scoreInstitution(institution, query) {
  const current = institutionSearchTerms(institution);
  const former = institutionFormerTerms(institution);
  if (current.some((term) => term === query)) return 0;
  if (former.some((term) => term === query)) return 1;
  if (current.some((term) => term.startsWith(query))) return 2;
  if (former.some((term) => term.startsWith(query))) return 3;
  if (current.concat(former).some((term) => term.includes(query))) return 4;
  return -1;
}

export function matchedFormerName(institution, text) {
  const query = normalizeInstitutionText(text);
  if (!institution || !query) {
    return '';
  }
  return (
    institution.formerNames.find((name) => {
      const normalized = normalizeInstitutionText(name);
      return normalized.startsWith(query) || query.startsWith(normalized);
    }) || ''
  );
}

export function searchInstitutions(query, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 8;
  const types = Array.isArray(options.types) ? options.types : options.types ? [options.types] : [];
  const normalized = normalizeInstitutionText(query);
  const pool = INSTITUTION_CATALOG.filter((item) => !types.length || types.includes(item.type));
  if (!normalized) {
    return pool.slice(0, limit);
  }
  return pool
    .map((item) => ({ item, score: scoreInstitution(item, normalized) }))
    .filter((candidate) => candidate.score >= 0)
    .sort(
      (left, right) =>
        left.score - right.score || left.item.shortName.localeCompare(right.item.shortName)
    )
    .slice(0, limit)
    .map((candidate) => candidate.item);
}
