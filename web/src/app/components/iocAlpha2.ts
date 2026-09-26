// IOC country codes (uppercased) -> lowercase alpha-2, the form flag-icons keys
// on. Athletes carry IOC codes (as used by sport federations / scoreboards),
// which diverge from ISO 3166-1 alpha-3 for many countries — e.g. GER not DEU,
// SUI not CHE. Only codes that DIFFER from their ISO alpha-3 spelling need an
// entry; the rest fall through to the ISO map (ALPHA3_TO_ALPHA2). Consulted
// before that map in CountryFlag.toAlpha2.
//
// Hand-maintained: there is no machine-readable IOC source bundled. Add codes as
// athletes from new nations appear.
export const IOC_TO_ALPHA2: Readonly<Record<string, string>> = {
  ALG: 'dz', // Algeria
  ANG: 'ao', // Angola
  ANT: 'ag', // Antigua and Barbuda
  ARU: 'aw', // Aruba
  ASA: 'as', // American Samoa
  BAH: 'bs', // Bahamas
  BAN: 'bd', // Bangladesh
  BAR: 'bb', // Barbados
  BIZ: 'bz', // Belize
  BOT: 'bw', // Botswana
  BRU: 'bn', // Brunei
  BUL: 'bg', // Bulgaria
  CAM: 'kh', // Cambodia
  CAY: 'ky', // Cayman Islands
  CHA: 'td', // Chad
  CHI: 'cl', // Chile
  CGO: 'cg', // Congo
  COD: 'cd', // DR Congo
  CRC: 'cr', // Costa Rica
  CRO: 'hr', // Croatia
  DEN: 'dk', // Denmark
  ENG: 'gb', // England — entered by athletes as their nation, flown as the UK
  ESA: 'sv', // El Salvador
  FIJ: 'fj', // Fiji
  GAM: 'gm', // Gambia
  GBS: 'gw', // Guinea-Bissau
  GEQ: 'gq', // Equatorial Guinea
  GER: 'de', // Germany
  GRE: 'gr', // Greece
  GRN: 'gd', // Grenada
  GUA: 'gt', // Guatemala
  GUI: 'gn', // Guinea
  HAI: 'ht', // Haiti
  HON: 'hn', // Honduras
  INA: 'id', // Indonesia
  IRI: 'ir', // Iran
  ISV: 'vi', // US Virgin Islands
  IVB: 'vg', // British Virgin Islands
  KSA: 'sa', // Saudi Arabia
  KUW: 'kw', // Kuwait
  LAT: 'lv', // Latvia
  LBA: 'ly', // Libya
  LBR: 'lr', // Liberia
  LCA: 'lc', // Saint Lucia
  LES: 'ls', // Lesotho
  LIB: 'lb', // Lebanon
  MAD: 'mg', // Madagascar
  MAS: 'my', // Malaysia
  MAW: 'mw', // Malawi
  MGL: 'mn', // Mongolia
  MON: 'mc', // Monaco
  MRI: 'mu', // Mauritius
  MTN: 'mr', // Mauritania
  MYA: 'mm', // Myanmar
  NCA: 'ni', // Nicaragua
  NED: 'nl', // Netherlands
  NEP: 'np', // Nepal
  NGR: 'ng', // Nigeria
  NIG: 'ne', // Niger
  OMA: 'om', // Oman
  PAR: 'py', // Paraguay
  PHI: 'ph', // Philippines
  POR: 'pt', // Portugal
  PUR: 'pr', // Puerto Rico
  RSA: 'za', // South Africa
  SAM: 'ws', // Samoa
  SEY: 'sc', // Seychelles
  SIN: 'sg', // Singapore
  SLO: 'si', // Slovenia
  SOL: 'sb', // Solomon Islands
  SRI: 'lk', // Sri Lanka
  SUD: 'sd', // Sudan
  SUI: 'ch', // Switzerland
  TAN: 'tz', // Tanzania
  TGA: 'to', // Tonga
  TPE: 'tw', // Chinese Taipei
  UAE: 'ae', // United Arab Emirates
  URU: 'uy', // Uruguay
  VAN: 'vu', // Vanuatu
  VIE: 'vn', // Vietnam
  ZAM: 'zm', // Zambia
  ZIM: 'zw', // Zimbabwe
};
