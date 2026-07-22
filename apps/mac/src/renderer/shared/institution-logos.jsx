import React from 'react';

import aubLogo from '../assets/institution-logos/aub.svg';
import bdoLogo from '../assets/institution-logos/bdo.svg';
import bpiLogo from '../assets/institution-logos/bpi.svg';
import chinabankLogo from '../assets/institution-logos/chinabank.svg';
import cimbLogo from '../assets/institution-logos/cimb.svg';
import eastwestLogo from '../assets/institution-logos/eastwest.svg';
import gcashLogo from '../assets/institution-logos/gcash.svg';
import gotymeLogo from '../assets/institution-logos/gotyme.svg';
import hsbcLogo from '../assets/institution-logos/hsbc.svg';
import landbankLogo from '../assets/institution-logos/landbank.svg';
import mayaLogo from '../assets/institution-logos/maya.svg';
import metrobankLogo from '../assets/institution-logos/metrobank.svg';
import pnbLogo from '../assets/institution-logos/pnb.svg';
import rcbcLogo from '../assets/institution-logos/rcbc.svg';
import securitybankLogo from '../assets/institution-logos/securitybank.svg';
import unionbankLogo from '../assets/institution-logos/unionbank.svg';

function wordmark(label, color, fontSize = 14) {
  return (
    <svg viewBox="0 0 48 48">
      <text
        dominantBaseline="central"
        fill={color}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight="800"
        textAnchor="middle"
        x="24"
        y="24"
      >
        {label}
      </text>
    </svg>
  );
}

function badge(label, background, foreground = '#ffffff', fontSize = 14) {
  return (
    <svg viewBox="0 0 48 48">
      <rect fill={background} height="44" rx="10" width="44" x="2" y="2" />
      <text
        dominantBaseline="central"
        fill={foreground}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight="800"
        textAnchor="middle"
        x="24"
        y="24"
      >
        {label}
      </text>
    </svg>
  );
}

/* Official local SVG assets are used wherever a reliable published vector is
   available. The remaining entries keep an offline brand-colored fallback.
   Keys intentionally mirror institution-catalog.js. */
export const INSTITUTION_LOGOS = {
  bdo: bdoLogo,
  bpi: bpiLogo,
  metrobank: metrobankLogo,
  landbank: landbankLogo,
  chinabank: chinabankLogo,
  rcbc: rcbcLogo,
  securitybank: securitybankLogo,
  pnb: pnbLogo,
  unionbank: unionbankLogo,
  dbp: (
    <svg viewBox="0 0 48 48">
      <circle cx="20" cy="26" fill="#003478" r="19" />
      <ellipse cx="20" cy="26" fill="none" rx="7.5" ry="19" stroke="#fff" strokeWidth="1.4" />
      <path
        d="M1.5 26h37M4.5 18q15.5-4.5 31 0M4.5 34q15.5 4.5 31 0"
        fill="none"
        stroke="#fff"
        strokeWidth="1.4"
      />
      <path
        d="M39.5 3c-5.5 6.5-8 13.5-6.5 20.5 1 6 4.5 10.5 9 12.5-3-5-3.5-10-1-14.5 1.5 4 4 5.5 3.5 9.5 1.5-4.5 1.3-11.5 0-17-1.5-5-3-8.5-5-11Z"
        fill="#cf2030"
      />
    </svg>
  ),
  eastwest: eastwestLogo,
  aub: aubLogo,
  bankcom: badge('BC', '#1b3f94', '#ffffff', 17),
  psbank: badge('PS', '#d3202f', '#ffffff', 16),
  maybank: (
    <svg viewBox="0 0 48 48">
      <circle cx="24" cy="24" fill="#ffc20e" r="22" />
      <path
        d="m14 8 5.5 8L9 16.5m25-8.5 5 8.5L28.5 16M24 17.5l4.5 5-1 8.5-3.5 5.5-3.5-5.5-1-8.5Z"
        fill="#231f20"
      />
      <path
        d="m6 20 11 3M5 26l12 1M7 32.5l10-1.5M42 20l-11 3m12 3-12 1m10 5.5L31 31"
        fill="none"
        stroke="#231f20"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
    </svg>
  ),
  cimb: cimbLogo,
  hsbc: hsbcLogo,
  gotyme: gotymeLogo,
  mayabank: mayaLogo,
  tonik: (
    <svg viewBox="0 0 48 48">
      <circle cx="24" cy="24" fill="#7c2bff" r="22" />
      <path d="M27 8 14.5 26.5h7L19 40l14.5-19.5h-7L31 8Z" fill="#fff" />
    </svg>
  ),
  uniondigital: badge('UD', '#f47b20', '#ffffff', 15),
  uno: wordmark('UNO', '#ff5f00', 14),
  maribank: badge('M', '#ee4d2d', '#ffffff', 17),
  gcash: gcashLogo,
  mayawallet: mayaLogo,
  grabpay: badge('Grab', '#00b14f', '#ffffff', 12),
  shopeepay: badge('S', '#ee4d2d', '#ffffff', 18),
  coinsph: badge('C', '#0b63ce', '#ffffff', 18),
  paymaya_business: badge('P', '#f5a000', '#ffffff', 18)
};
