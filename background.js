/**
 * background.js — Extension Service Worker.
 * Receives files from content.js via chrome.runtime.connect,
 * processes them locally, and returns the result.
 *
 * Runs outside page CSP — that's why it's here rather than in a Web Worker
 * from a content script (sites like ChatGPT, Claude, etc. block
 * chrome-extension:// as worker-src via CSP headers).
 *
 * Binary data is transferred as base64 strings because
 * chrome.runtime port.postMessage does not guarantee correct
 * structured cloning of TypedArray across process boundaries.
 */
'use strict';

importScripts(
  'vendor/jszip.min.js',
  'lib/validators.js',
  'lib/entity-finder.js',
  'lib/replacer.js',
  'lib/docx-parser.js'
);

// ─── Base64 ↔ Uint8Array ──────────────────────────────────────────────────────
function base64ToUint8(b64) {
  const binary = atob(b64);
  const uint8  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return uint8;
}

function uint8ToBase64(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

// ─── Persistent connection from content.js ────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'docx-processor') return;

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === 'PARSE') {
        await handleParse(msg, port);
      } else if (msg.type === 'APPLY') {
        await handleApply(msg, port);
      }
    } catch (err) {
      safeSend(port, { type: 'ERROR', message: err.message || String(err) });
    }
  });
});

// ─── PARSE ────────────────────────────────────────────────────────────────────
async function handleParse({ data, filename, options }, port) {
  prog(port, 5, 'Opening file…');

  const uint8 = base64ToUint8(data);
  const { zip, parts } = await parseDocx(uint8);
  prog(port, 30, 'Analysing structure…');

  const enabledCategories = new Set(
    options.enabledCategories || Object.keys(CATEGORIES)
  );

  const allParas = getAllParagraphs(parts);
  const fullText = getFullDocumentText(parts);

  prog(port, 40, 'Scanning for party details block…');
  const { text: reqText } = detectRequisitesBlock(fullText);
  const kb = buildKnowledgeBase(reqText);

  prog(port, 50, `Party details: ${kb.persons.length} persons, ${kb.companies.length} companies`);

  const entities = [];
  let entityId   = 0;
  const total    = allParas.length;

  for (let i = 0; i < total; i++) {
    const para = allParas[i];
    if (!para.virtualText.trim()) continue;

    for (const match of findEntities(para.virtualText, enabledCategories, kb)) {
      entities.push({
        id:              String(++entityId),
        partName:        para.partName,
        paraIdx:         para.paraIdx,
        start:           match.start,
        end:             match.end,
        category:        match.category,
        value:           match.value,
        replacementText: '',
        enabled:         true,
      });
    }

    if (i % 30 === 0) {
      prog(port, 55 + Math.round((i / total) * 35), `Paragraphs: ${i + 1} / ${total}`);
    }
  }

  const r = new Replacer('placeholder');
  r.precompute(entities);

  const stats = { total: entities.length, byCategory: {} };
  for (const e of entities) {
    stats.byCategory[e.category] = (stats.byCategory[e.category] || 0) + 1;
  }

  prog(port, 100, 'Analysis complete');
  safeSend(port, { type: 'ENTITIES', entities, stats });
}

// ─── APPLY ────────────────────────────────────────────────────────────────────
async function handleApply({ entities, mode, data, filename, exportMapping }, port) {
  prog(port, 5, 'Opening file…');

  const uint8 = base64ToUint8(data);
  const { zip, parts } = await parseDocx(uint8);

  prog(port, 20, 'Applying replacements…');

  if (mode !== 'placeholder') {
    const r = new Replacer(mode);
    for (const e of entities) {
      if (e.enabled) e.replacementText = r.getReplacement(e.value, e.category);
    }
  }

  prog(port, 50, 'Rebuilding paragraphs…');
  await applyEntityReplacements(zip, parts, entities);

  prog(port, 80, 'Packing…');
  const resultBuffer = await serializeDocx(zip);

  let mapping = null;
  if (exportMapping) {
    mapping = {};
    for (const e of entities) {
      if (e.enabled && e.replacementText && mode === 'placeholder') {
        mapping[e.replacementText] = e.value;
      }
    }
  }

  const resultFilename = filename.replace(/\.docx$/i, '_anonymized.docx');
  prog(port, 100, 'Done');
  safeSend(port, {
    type:     'RESULT',
    data:     uint8ToBase64(new Uint8Array(resultBuffer)),
    mapping,
    filename: resultFilename,
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function prog(port, percent, message) {
  safeSend(port, { type: 'PROGRESS', percent, message });
}

function safeSend(port, msg) {
  try { port.postMessage(msg); } catch (_) { /* port closed */ }
}
