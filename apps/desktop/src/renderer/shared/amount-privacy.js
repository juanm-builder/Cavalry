export const HIDDEN_AMOUNT = '••••';

// Match formatted money, including compact chart labels and locale-specific
// separators. Dates, counts, percentages and currency names alone stay visible.
const CURRENCY_CODES =
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG ZWL'
    .split(' ')
    .join('|');
const code = `(?:${CURRENCY_CODES})`;
const currency = `(?:\\b${code}\\b|(?:US|CA|AU|NZ|HK|NT|SG|R)?\\p{Sc})`;
const number = String.raw`\p{Nd}+(?:[.,\u066b\u066c'’\u00a0\u202f]\p{Nd}+| \p{Nd}{3}(?!\p{Nd}))*(?:[kKmMbB](?![a-zA-Z]))?`;
const sign = String.raw`[+−-]?\s*`;
const MONEY_PATTERN = new RegExp(
  `(?:\\(${sign}${currency}\\s*${sign}${number}\\)|[+−-]?${currency}\\s*${sign}${number}|[+−-]\\s+${currency}\\s*${sign}${number}|\\(${sign}${number}\\s*${currency}\\)|[+−-]?${number}\\s*${currency})`,
  'gu'
);

/** Display-only redaction; never use this for saved values, exports or commands. */
export function maskFinancialText(value, replacement = HIDDEN_AMOUNT) {
  return typeof value === 'string' ? value.replace(MONEY_PATTERN, replacement) : value;
}
