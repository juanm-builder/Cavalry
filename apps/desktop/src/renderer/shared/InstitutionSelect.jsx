import React, { useId, useMemo, useState } from 'react';

import {
  findInstitutionById,
  matchedFormerName,
  resolveInstitution,
  searchInstitutions
} from '@cavalry/finance-core';

import { CavalryIcon } from './CavalryIcon.jsx';
import { INSTITUTION_LOGOS } from './institution-logos.jsx';

export function InstitutionMark({
  institutionId,
  fallbackIcon = 'account_balance',
  className = ''
}) {
  const institution = findInstitutionById(institutionId);
  if (!institution) {
    // The glyph sits inside the badge rather than being it, so the artwork
    // keeps its breathing room instead of filling the disc edge to edge.
    return (
      <span
        aria-hidden="true"
        className={`institution-mark-fallback${className ? ` ${className}` : ''}`}
      >
        <CavalryIcon name={fallbackIcon} />
      </span>
    );
  }
  const logo = INSTITUTION_LOGOS[institution.id];
  const logoContent = typeof logo === 'string' ? <img alt="" draggable="false" src={logo} /> : logo;
  return (
    <span
      aria-hidden="true"
      className={`institution-mark${logo ? ' has-logo' : ''}${className ? ` ${className}` : ''}`}
      data-institution-id={institution.id}
      data-monogram-length={logo ? undefined : institution.monogram.length}
      style={{ '--institution-color': institution.color }}
      title={institution.name}
    >
      {logoContent || institution.monogram}
    </span>
  );
}

const BANK_INSTITUTION_TYPES = ['bank', 'digital_bank'];

const SUBTYPE_INSTITUTION_TYPES = {
  wallet: ['e_wallet', 'digital_bank'],
  bank: BANK_INSTITUTION_TYPES,
  checking: BANK_INSTITUTION_TYPES,
  savings: BANK_INSTITUTION_TYPES,
  credit_card: BANK_INSTITUTION_TYPES,
  time_deposit: BANK_INSTITUTION_TYPES
};

export function InstitutionSelect({
  id,
  institution,
  institutionId,
  onChange,
  placeholder = 'e.g., BPI',
  accountSubtype = '',
  ariaDescribedBy,
  required = false
}) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const generatedId = useId();
  const listboxId = `${id || generatedId}-institution-options`;
  const query = String(institution || '');
  const results = useMemo(() => {
    const preferredTypes = SUBTYPE_INSTITUTION_TYPES[accountSubtype] || [];
    return searchInstitutions(query, {
      limit: 6,
      ...(preferredTypes.length ? { types: preferredTypes } : {})
    });
  }, [accountSubtype, query]);
  const selected = findInstitutionById(institutionId);
  const activeResult = results[highlightIndex] || null;

  function commitText(text) {
    const resolved = resolveInstitution(text);
    onChange({ institution: text, institutionId: resolved ? resolved.id : '' });
  }

  function choose(item) {
    onChange({ institution: item.shortName, institutionId: item.id });
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      setOpen(true);
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (results[highlightIndex]) {
        event.preventDefault();
        choose(results[highlightIndex]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className={`institution-select${selected ? ' has-selection' : ''}`}>
      <div className="institution-select-input">
        {selected ? (
          <InstitutionMark className="institution-select-input-mark" institutionId={selected.id} />
        ) : null}
        <input
          aria-describedby={ariaDescribedBy}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeResult ? `${listboxId}-${activeResult.id}` : undefined
          }
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
          id={id}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            commitText(event.target.value);
            setOpen(true);
            setHighlightIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          required={required}
          role="combobox"
          value={query}
        />
        <CavalryIcon className="institution-select-search-icon" name="search" />
      </div>
      {open && results.length ? (
        <ul className="institution-select-popover" id={listboxId} role="listbox">
          {results.map((item, index) => {
            const formerName = matchedFormerName(item, query);
            return (
              <li
                aria-selected={selected?.id === item.id}
                className={`institution-select-option${
                  index === highlightIndex ? ' is-highlighted' : ''
                }`}
                id={`${listboxId}-${item.id}`}
                key={item.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
                role="option"
              >
                <InstitutionMark institutionId={item.id} />
                <span>
                  <strong>{item.shortName}</strong>
                  <small>
                    {formerName
                      ? `Formerly ${formerName}`
                      : item.name !== item.shortName
                        ? item.name
                        : item.type === 'e_wallet'
                          ? 'E-Wallet'
                          : item.type === 'digital_bank'
                            ? 'Digital Bank'
                            : ''}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
