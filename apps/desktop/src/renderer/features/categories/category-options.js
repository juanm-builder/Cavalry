export const RULE_OPERATOR_OPTIONS = Object.freeze([
  { value: 'contains', label: 'Description contains' },
  { value: 'starts_with', label: 'Description starts with' },
  { value: 'equals', label: 'Description equals' }
]);

export const CATEGORY_GROUP_BY_OPTIONS = Object.freeze([
  { value: 'type', label: 'Type' },
  { value: 'spending', label: 'Spending' },
  { value: 'name', label: 'Name' }
]);

export const CATEGORY_ICONS = Object.freeze([
  'category',
  'payments',
  'account_balance',
  'savings',
  'trending_up',
  'credit_card',
  'receipt_long',
  'shopping_cart',
  'restaurant',
  'local_cafe',
  'directions_car',
  'directions_bus',
  'local_gas_station',
  'local_parking',
  'shopping_bag',
  'checkroom',
  'home',
  'home_work',
  'electrical_services',
  'water_drop',
  'wifi',
  'phone_iphone',
  'medical_services',
  'local_hospital',
  'science',
  'fitness_center',
  'favorite',
  'flight',
  'luggage',
  'school',
  'menu_book',
  'work',
  'business_center',
  'redeem',
  'volunteer_activism',
  'celebration',
  'sports_esports',
  'confirmation_number',
  'movie',
  'music_note',
  'pets',
  'child_care'
]);

export const CATEGORY_COLORS = Object.freeze([
  '#1a3fe9',
  '#4d79eb',
  '#499eee',
  '#809fec',
  '#c47a2c',
  '#7758b8',
  '#626a78'
]);

const CATEGORY_ICON_SET = new Set(CATEGORY_ICONS);

const CATEGORY_ICON_RULES = Object.freeze([
  ['payments', /\b(?:salary|payroll|wages?|income|earnings?|allowance)\b/],
  ['savings', /\b(?:savings?|reserve|emergency\s+fund|time\s+deposit)\b/],
  ['trending_up', /\b(?:investments?|stocks?|mutual\s+funds?|portfolio|interest|dividends?)\b/],
  ['credit_card', /\b(?:debts?|credit\s+cards?|card\s+payments?|loans?|repayments?|mortgages?)\b/],
  [
    'receipt_long',
    /\b(?:bank\s+fees?|bank\s+charges?|transaction\s+fees?|atm\s+fees?|tax(?:es)?|withholding)\b/
  ],
  ['shopping_cart', /\b(?:groceries|grocery|supermarkets?|markets?)\b/],
  ['local_cafe', /\b(?:coffee|cafes?|tea)\b/],
  ['restaurant', /\b(?:food|dining|restaurants?|meals?|snacks?)\b/],
  ['favorite', /\b(?:personal\s+care|beauty|wellness|spas?|grooming|salons?|cosmetics?)\b/],
  ['local_gas_station', /\b(?:fuel|gasoline|petrol)\b/],
  ['local_parking', /\bparking\b/],
  [
    'directions_car',
    /\b(?:transport(?:ation)?|commut(?:e|ing)|cars?|rides?|taxis?|grab|vehicles?)\b/
  ],
  ['directions_bus', /\b(?:buses|bus|trains?|transit)\b/],
  ['home', /\b(?:rent|housing|houses?|homes?)\b/],
  ['electrical_services', /\b(?:electricity|electric|power)\b/],
  ['water_drop', /\bwater\b/],
  ['wifi', /\b(?:internet|wi[ -]?fi|broadband|fib(?:er|re))\b/],
  ['phone_iphone', /\b(?:telecom|telecommunications?|mobile|phones?|cellular|data|load)\b/],
  ['receipt_long', /\b(?:bills?|utilities|utility|subscriptions?)\b/],
  ['medical_services', /\b(?:doctors?|clinics?|medicine|medical|health(?:care)?|hospitals?)\b/],
  ['science', /\b(?:labs?|tests?|diagnostics?)\b/],
  ['fitness_center', /\b(?:fitness|gyms?|exercise|sports?)\b/],
  ['flight', /\b(?:travel|flights?|airlines?|trips?|vacations?)\b/],
  ['school', /\b(?:education|schools?|courses?|tuition|learning)\b/],
  ['menu_book', /\b(?:books?|reading)\b/],
  ['checkroom', /\b(?:clothing|clothes|apparel|fashion)\b/],
  [
    'shopping_bag',
    /\b(?:shopping|personal\s+items?|household|electronics?|devices?|lifestyle|random|misc(?:ellaneous)?)\b/
  ],
  ['business_center', /\b(?:business|clients?|freelance)\b/],
  ['work', /\b(?:work|office|professional)\b/],
  ['volunteer_activism', /\b(?:donations?|charity|for\s+others)\b/],
  ['redeem', /\b(?:gifts?|presents?)\b/],
  ['celebration', /\b(?:parties|party|celebrations?|events?)\b/],
  ['sports_esports', /\b(?:games?|gaming|leisure)\b/],
  ['movie', /\b(?:movies?|cinema|entertainment)\b/],
  ['music_note', /\b(?:music|spotify)\b/],
  ['pets', /\b(?:pets?|dogs?|cats?)\b/],
  ['child_care', /\b(?:children|child|babies|baby|kids?)\b/]
]);

function normalizedText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLocaleLowerCase()
    .replace(/[_/&-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isSupportedCategoryIcon(value) {
  return CATEGORY_ICON_SET.has(String(value == null ? '' : value).trim());
}

export function matchCategoryIcon(name, type = '') {
  const text = normalizedText(name);
  const categoryType = normalizedText(type);

  const matchedRule = CATEGORY_ICON_RULES.find(([, pattern]) => pattern.test(text));
  if (matchedRule) return matchedRule[0];
  if (categoryType === 'income') return 'payments';
  if (categoryType === 'savings') return 'savings';
  if (categoryType === 'debt') return 'credit_card';
  return 'category';
}
