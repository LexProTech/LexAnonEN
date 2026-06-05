/**
 * entity-finder.js
 * Hybrid entity detection: regex + context rules.
 * English-only version — detects PII common in English-language legal documents.
 *
 * Depends on validators.js (must be loaded first).
 */
'use strict';

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------
const CATEGORIES = {
  PERSON:   { label: 'Full Name',        placeholder: 'NAME',     color: '#4CAF50', defaultOn: true  },
  COMPANY:  { label: 'Company / Entity', placeholder: 'COMPANY',  color: '#2196F3', defaultOn: true  },
  SSN:      { label: 'SSN',              placeholder: 'SSN',      color: '#E91E63', defaultOn: true  },
  TAXID:    { label: 'Tax ID / EIN',     placeholder: 'TAXID',    color: '#FF5722', defaultOn: true  },
  SWIFT:    { label: 'SWIFT',            placeholder: 'SWIFT',    color: '#FF8F00', defaultOn: true  },
  IBAN:     { label: 'IBAN',             placeholder: 'IBAN',     color: '#FFA000', defaultOn: true  },
  EMAIL:    { label: 'Email',            placeholder: 'EMAIL',    color: '#D32F2F', defaultOn: true  },
  PHONE:    { label: 'Phone',            placeholder: 'PHONE',    color: '#C62828', defaultOn: true  },
  URL:      { label: 'URL / Website',    placeholder: 'URL',      color: '#B71C1C', defaultOn: true  },
  ADDRESS:  { label: 'Address',          placeholder: 'ADDRESS',  color: '#5D4037', defaultOn: true  },
  CONTRACT: { label: 'Contract No.',     placeholder: 'CONTRACT', color: '#455A64', defaultOn: false },
  AMOUNT:   { label: 'Amounts',          placeholder: 'AMOUNT',   color: '#546E7A', defaultOn: false },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Escapes RegExp special characters */
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collects regex matches into the matches array.
 * valueGroupIdx: if provided, that capture group is the entity value;
 *                otherwise the whole match is used.
 */
function collect(matches, text, regex, category, options = {}) {
  const { validator, valueGroupIdx } = options;
  let m;
  regex.lastIndex = 0;

  while ((m = regex.exec(text)) !== null) {
    let valueStr, valueStart, valueEnd;

    if (valueGroupIdx !== undefined && m[valueGroupIdx] !== undefined) {
      valueStr   = m[valueGroupIdx];
      const groupOffset = m[0].lastIndexOf(valueStr);
      valueStart = m.index + groupOffset;
      valueEnd   = valueStart + valueStr.length;
    } else {
      valueStr   = m[0];
      valueStart = m.index;
      valueEnd   = m.index + m[0].length;
    }

    if (validator && !validator(valueStr)) continue;

    matches.push({ start: valueStart, end: valueEnd, category, value: valueStr });
  }
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Finds entities in text (English documents).
 * @param {string}     text
 * @param {Set<string>} enabledCategories
 * @param {Object}     [knowledgeBase]  — {persons:[], companies:[]} from requisites block
 * @returns {Array<{start, end, category, value}>}
 */
function findEntities(text, enabledCategories, knowledgeBase = null) {
  const matches = [];
  const en = (cat) => enabledCategories.has(cat);

  // ── 1. Email (most specific — match first) ─────────────────────────────
  if (en('EMAIL')) {
    collect(matches, text,
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      'EMAIL');
  }

  // ── 2. URL ────────────────────────────────────────────────────────────
  if (en('URL')) {
    collect(matches, text,
      /https?:\/\/[^\s,;«»"'<>()\[\]{}\n]{3,}/g,
      'URL');
    collect(matches, text,
      /(?<![a-zA-Z\d.])www\.[a-zA-Z0-9\-]{2,}\.[a-zA-Z]{2,}[^\s,;«»"'<>()\[\]{}\n]*/g,
      'URL');
  }

  // ── 3. SSN ────────────────────────────────────────────────────────────
  if (en('SSN')) {
    // With label
    collect(matches, text,
      /(?:SSN|Social\s+Security\s+(?:Number|No\.?))[:\s#]{0,5}(\d{3}[-\s]\d{2}[-\s]\d{4})\b/gi,
      'SSN',
      { valueGroupIdx: 1 });
    // Without label: XXX-XX-XXXX (not 000/666/9xx in first block)
    collect(matches, text,
      /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
      'SSN');
  }

  // ── 4. Tax ID / EIN ───────────────────────────────────────────────────
  if (en('TAXID')) {
    // With label
    collect(matches, text,
      /(?:EIN|FEIN|Federal\s+Tax\s+ID|Tax\s+(?:ID|Identification)\s+(?:Number|No\.?))[:\s#]{0,5}(\d{2}-\d{7})\b/gi,
      'TAXID',
      { valueGroupIdx: 1 });
    // Without label: XX-XXXXXXX
    collect(matches, text,
      /\b(\d{2}-\d{7})\b/g,
      'TAXID',
      { valueGroupIdx: 1 });
  }

  // ── 5. SWIFT ──────────────────────────────────────────────────────────
  if (en('SWIFT')) {
    collect(matches, text,
      /(?:SWIFT|BIC)[:\s]{0,5}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi,
      'SWIFT',
      { valueGroupIdx: 1 });
    // Without label — full 8/11-character codes only
    collect(matches, text,
      /\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g,
      'SWIFT');
  }

  // ── 6. IBAN ───────────────────────────────────────────────────────────
  if (en('IBAN')) {
    collect(matches, text,
      /\b([A-Z]{2}\d{2}[A-Z0-9]{4}[\dA-Z]{7,28})\b/g,
      'IBAN');
  }

  // ── 7. Phone ──────────────────────────────────────────────────────────
  if (en('PHONE')) {
    // International with +
    collect(matches, text,
      /\+[1-9]\d{0,2}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{2,4}[\s\-]?\d{2,4}(?:[\s\-]?\d{1,4})?/g,
      'PHONE');
    // US/Canada: (XXX) XXX-XXXX or XXX-XXX-XXXX
    collect(matches, text,
      /\(?\b[2-9]\d{2}\)?[\s\-][2-9]\d{2}[\s\-]\d{4}\b/g,
      'PHONE');
  }

  // ── 8. Company / Legal entity ─────────────────────────────────────────
  if (en('COMPANY')) {
    // Full word suffixes
    collect(matches, text,
      /[A-Z][A-Za-z0-9\s&'\-]{1,60}?\s+(?:Corporation|Incorporated|Limited|Company|Partners|Associates|Group|Holdings|Enterprises|Solutions|Services|Technologies|Industries|International)\b/g,
      'COMPANY');

    // Abbreviation suffixes (LLC, LLP, LP, PLC, GmbH, etc.)
    collect(matches, text,
      /[A-Z][A-Za-z0-9\s&'\-]{1,60}?\s+(?:LLC|LLP|LP|PLLC|PC|PLC|GmbH|SE\b|AG\b|NV\b|BV\b|SA\b|SAS\b|SRL\b)(?=[,.\s\n;("']|$)/g,
      'COMPANY');

    // UAE Free Zone types
    collect(matches, text,
      /[A-Z][A-Za-z0-9\s&'\-]{1,60}?\s+(?:FZ[-\s]LLC|FZE\b|FZCO\b|DMCC\b|DIFC\b)(?=[,.\s\n;("']|$)/g,
      'COMPANY');

    // Prefix abbreviation + quoted name
    collect(matches, text,
      /(?:LLC|Ltd\.?|Inc\.?|Corp\.?|GmbH|PLC)\s+"[^"\n]{1,60}"/g,
      'COMPANY');

    // "hereinafter referred to as / known as / called «...»"
    collect(matches, text,
      /(?:hereinafter\s+(?:referred\s+to\s+as|called|known\s+as)|referred\s+to\s+as)\s+"([^"\n]{1,60})"/gi,
      'COMPANY',
      { valueGroupIdx: 1 });

    // "the [Party / Client / Contractor / Vendor] followed by a company name"
    collect(matches, text,
      /(?:between|party\s*(?:1|2|one|two|A|B)|client|contractor|employer|vendor|supplier|buyer|seller|licensor|licensee)[:\s]+("?[A-Z][A-Za-z0-9\s&'\-]{2,60}?(?:LLC|LLP|LP|Inc\.?|Corp\.?|Ltd\.?|PLC|GmbH)?)"?(?=[,;\n.]|$)/gi,
      'COMPANY',
      { valueGroupIdx: 1 });
  }

  // ── 9. Full Name / Person ─────────────────────────────────────────────
  if (en('PERSON')) {
    // With salutation: Mr./Mrs./Ms./Dr./Prof. + First [Middle] Last
    collect(matches, text,
      /(?:Mr\.?|Mrs\.?|Ms\.?|Miss\b|Dr\.?|Prof\.?|Sir\b|Mx\.?)\s+[A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25}){0,2}/g,
      'PERSON');

    // Contract context: signed by / represented by / between
    collect(matches, text,
      /(?:signed\s+by|executed\s+by|represented\s+by|on\s+behalf\s+of|between|undersigned)[:\s,]+([A-Z][a-z]{2,25}(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]{2,25}){1,2})(?=[,;\n.(]|$)/gi,
      'PERSON',
      { valueGroupIdx: 1 });

    // After "Name:" / "Full Name:" / "Employee:" / "Client:"
    collect(matches, text,
      /(?:Full\s+)?Name[:\s]+([A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25}){1,2})/gi,
      'PERSON',
      { valueGroupIdx: 1 });

    // Signature block: "For ALL-CAPS COMPANY First Last"
    collect(matches, text,
      /(?:For|Signed\s+by)\s+(?:[A-Z][A-Z0-9]*\s+)+([A-Z][a-z]{2,25}\s+[A-Z][a-z]{2,25})(?=\s|$)/g,
      'PERSON',
      { valueGroupIdx: 1 });

    // First Last before a job title
    collect(matches, text,
      /([A-Z][a-z]{2,25}\s+[A-Z][a-z]{2,25})\s+(?:Director|CEO|CFO|COO|CTO|President|Manager|Officer|Chairman|Secretary|Treasurer|Partner|Principal|Authorized\s+Signatory|Signatory|Representative)\b/g,
      'PERSON',
      { valueGroupIdx: 1 });

    // Knowledge base: names found in the requisites block
    if (knowledgeBase && knowledgeBase.persons) {
      for (const person of knowledgeBase.persons) {
        if (person.length < 4) continue;
        collect(matches, text, new RegExp(escRe(person), 'g'), 'PERSON');
      }
    }
  }

  // ── 10. Address ───────────────────────────────────────────────────────
  if (en('ADDRESS')) {
    // Label-based address
    collect(matches, text,
      /(?:Address)[:\-]\s*([A-Za-z0-9][^\n]{5,200})/gi,
      'ADDRESS',
      { valueGroupIdx: 1 });

    // US address: number + street + city + state + ZIP
    collect(matches, text,
      /\d{1,5}[a-zA-Z]?\s+[A-Z][a-zA-Z]{1,30}(?:\s+[A-Za-z]{1,30}){0,3}\s+(?:Street|Avenue|Boulevard|Drive|Road|Lane|Court|Way|Circle|Place|Highway|Parkway|Trail|Terrace|St|Ave|Blvd|Dr|Rd|Ln|Ct|Hwy|Pkwy)\.?(?:[,\s]+(?:Suite|Ste|Apt|Unit|Floor|Fl|#)\.?\s*[A-Za-z0-9]+)?[,\s]+[A-Z][a-zA-Z\s]{2,30}[,\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi,
      'ADDRESS');

    // International: number + street + optional building block + city lines
    collect(matches, text,
      /\d{1,5}[a-zA-Z]?\s+[A-Z][a-zA-Z]{1,30}(?:\s+[A-Za-z]{1,30}){0,4}\s+(?:Street|Avenue|Boulevard|Drive|Road|Lane|Court|Way|Ave|St|Rd|Dr|Blvd|Ln)\.?(?:\s*,\s*(?:bldg\.?|building|office|fl\.?|floor|apt\.?|suite|ste\.?|unit)\.?\s*[\w\.]+)*(?:\s*,\s*[A-Za-z][A-Za-z\s\-]{1,40}){1,5}(?:\s*,\s*\d{4,10})?/gi,
      'ADDRESS');

    // UK address: number + street + city + postcode
    collect(matches, text,
      /\d{1,5}[a-zA-Z]?\s+[A-Z][a-zA-Z\s]{2,50}[,\s]+[A-Za-z\s]{2,40}[,\s]+[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}/gi,
      'ADDRESS');

    // UK postcode with label
    collect(matches, text,
      /(?:postcode|postal\s+code)[:\s]+([A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2})/gi,
      'ADDRESS',
      { valueGroupIdx: 1 });

    // P.O. Box
    collect(matches, text,
      /(?:P\.?\s*O\.?\s*Box|P\.?\s*B\.?)\s*[:\s#]*\d{1,10}(?:[,\s]+[A-Za-z][A-Za-z,\s\.]{2,80})?/gi,
      'ADDRESS');

    // Floor / premises (UAE/UK/EU offices)
    collect(matches, text,
      /[A-Za-z0-9]+,\s+(?:Ground\s+Floor|[1-9]\d*(?:st|nd|rd|th)?\s+Floor|Basement|Mezzanine)(?:,\s+Premises\s+(?:No\.?|#)?\s*[A-Za-z0-9\-]+)?(?:,\s+[A-Za-z][A-Za-z0-9\s]{2,50}){1,5}/gi,
      'ADDRESS');

    // Street without number + city/country
    collect(matches, text,
      /[A-Z][a-zA-Z]{2,40}\s+(?:street|avenue|road|lane|boulevard|drive|way)\s*,\s*[A-Za-z][A-Za-z\s]{1,40}(?:,\s*[A-Za-z0-9][A-Za-z0-9\s\.]{1,60}){1,4}/gi,
      'ADDRESS');
  }

  // ── 11. Contract number ───────────────────────────────────────────────
  if (en('CONTRACT')) {
    collect(matches, text,
      /(?:Contract|Agreement|Order|Invoice|PO)\s+(?:No\.?|#|Number)[:\s]*[A-Za-z0-9][A-Za-z0-9\/\-\.]{1,30}/gi,
      'CONTRACT');
    collect(matches, text,
      /#\s*[A-Za-z0-9][A-Za-z0-9\/\-\.]{2,30}/g,
      'CONTRACT');
  }

  // ── 12. Amounts / Money ───────────────────────────────────────────────
  if (en('AMOUNT')) {
    collect(matches, text,
      /\$\s*[\d,]+(?:\.\d{2})?|\b[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|AED)\b|€\s*[\d,]+(?:\.\d{2})?|£\s*[\d,]+(?:\.\d{2})?/gi,
      'AMOUNT');
  }

  return resolveOverlaps(matches);
}

// ---------------------------------------------------------------------------
// Custom categories
// ---------------------------------------------------------------------------

function findCustomEntities(text, customCategories, enabledCategories) {
  if (!customCategories || customCategories.length === 0) return [];
  const matches = [];
  for (const cat of customCategories) {
    if (!enabledCategories.has(cat.key) || !cat.pattern) continue;
    let regex;
    try {
      regex = new RegExp(cat.pattern, cat.flags || 'gi');
    } catch (_) {
      continue;
    }
    collect(matches, text, regex, cat.key);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Overlap resolution
// ---------------------------------------------------------------------------

/**
 * From overlapping matches, keeps:
 * 1. The one that starts earliest.
 * 2. When starts are equal — the longer one.
 */
function resolveOverlaps(matches) {
  matches.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start)
  );

  const result = [];
  let lastEnd = -1;

  for (const m of matches) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Requisites block heuristics
// ---------------------------------------------------------------------------

/**
 * Finds the "party details / signature" section at the end of the document.
 * Returns {text, offset}.
 */
function detectRequisitesBlock(fullText) {
  const patterns = [
    /signatures?\s+of\s+(?:the\s+)?parties/i,
    /party\s+(?:details|information)/i,
    /bank(?:ing)?\s+details/i,
    /contact\s+(?:details|information)/i,
    /(?:in\s+witness\s+whereof|executed\s+by\s+the\s+parties)/i,
    /signature\s+page/i,
    /(?:for\s+and\s+on\s+behalf\s+of)/i,
    /authorized\s+signatories/i,
  ];

  for (const pat of patterns) {
    const idx = fullText.search(pat);
    if (idx !== -1) {
      return { text: fullText.slice(idx), offset: idx };
    }
  }

  // Fallback: last 25% of the document
  const start = Math.max(0, Math.floor(fullText.length * 0.75));
  return { text: fullText.slice(start), offset: start };
}

/**
 * Builds a knowledge base of persons and companies from the requisites block.
 * @param {string} requisitesText
 * @returns {{persons: string[], companies: string[]}}
 */
function buildKnowledgeBase(requisitesText) {
  const persons   = [];
  const companies = [];

  // Companies
  const companyMatches = findEntities(requisitesText, new Set(['COMPANY']));
  for (const m of companyMatches) companies.push(m.value);

  let m;

  // Names with salutation
  const personEn = /(?:Mr\.?|Mrs\.?|Ms\.?|Miss\b|Dr\.?|Prof\.?)\s+[A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25}){0,2}/g;
  while ((m = personEn.exec(requisitesText)) !== null) {
    persons.push(m[0]);
  }

  // Name: First Last
  const nameLabel = /(?:Full\s+)?Name[:\s]+([A-Z][a-z]{1,25}(?:\s+[A-Z][a-z]{1,25}){1,2})/gi;
  while ((m = nameLabel.exec(requisitesText)) !== null) {
    persons.push(m[1]);
  }

  // Signature block: ___________ … Title:
  const sigBlock = /_{5,}([\s\S]{0,300}?)Title:/gi;
  while ((m = sigBlock.exec(requisitesText)) !== null) {
    const sigText = m[1].replace(/([a-z])([A-Z])/g, '$1 $2');
    const nameMatches = sigText.match(/[A-Z][a-z]{2,25}\s+[A-Z][a-z]{2,25}/g);
    if (nameMatches) nameMatches.forEach(n => persons.push(n.trim()));
  }

  // "represented by / acting as" → name before comma
  const repBy = /(?:represented\s+by|acting\s+(?:as|through)|in\s+the\s+person\s+of)[:\s,]+([A-Z][a-z]{2,25}(?:\s+[A-Z][a-z]{2,25}){1,2})(?=[,;(\n]|$)/gi;
  while ((m = repBy.exec(requisitesText)) !== null) {
    persons.push(m[1]);
  }

  return { persons: [...new Set(persons)], companies: [...new Set(companies)] };
}
