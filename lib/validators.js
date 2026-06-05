/**
 * validators.js
 * Checksum validators for document identifiers.
 */
'use strict';

// Russian INN — kept for compatibility but not used in EN-only mode
function validateINN(inn) {
  if (typeof inn !== 'string') inn = String(inn);
  inn = inn.replace(/\D/g, '');
  if (inn.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const sum = w.reduce((s, wi, i) => s + wi * +inn[i], 0);
    return (sum % 11 % 10) === +inn[9];
  }
  if (inn.length === 12) {
    const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const s1 = w1.reduce((s, wi, i) => s + wi * +inn[i], 0);
    const s2 = w2.reduce((s, wi, i) => s + wi * +inn[i], 0);
    return (s1 % 11 % 10) === +inn[10] && (s2 % 11 % 10) === +inn[11];
  }
  return false;
}

function validateOGRN(ogrn) {
  if (typeof ogrn !== 'string') ogrn = String(ogrn);
  ogrn = ogrn.replace(/\D/g, '');
  if (ogrn.length === 13) {
    const check = Number(BigInt(ogrn.slice(0, 12)) % 11n % 10n);
    return check === +ogrn[12];
  }
  if (ogrn.length === 15) {
    const check = Number(BigInt(ogrn.slice(0, 14)) % 13n % 10n);
    return check === +ogrn[14];
  }
  return false;
}

function validateBIK(bik) {
  if (typeof bik !== 'string') bik = String(bik);
  bik = bik.replace(/\D/g, '');
  return /^04\d{7}$/.test(bik);
}

function validateKPP(kpp) {
  if (typeof kpp !== 'string') kpp = String(kpp);
  kpp = kpp.replace(/\s/g, '');
  return /^\d{4}[\dA-Z]{2}\d{3}$/.test(kpp);
}
