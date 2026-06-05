/**
 * docx-parser.js
 * Парсинг и модификация .docx без DOMParser — чистая работа со строками.
 *
 * .docx — это ZIP-архив с XML внутри. Мы:
 * 1. Распаковываем через JSZip.
 * 2. Находим параграфы (<w:p>) регуляркой в строке.
 * 3. Внутри каждого параграфа ищем <w:t> и строим:
 *    - virtualText: конкатенация всех текстов
 *    - charMap[i] = {tIdx, localOffset} — позиция i виртуального текста
 *      показывает в какой <w:t> (tIdx) и на какой символ (localOffset) она приходится
 * 4. Поиск сущностей ведётся по virtualText.
 * 5. Замена — это набор «правок» {absStart, absEnd, newText} над XML-строкой,
 *    применяемых справа налево (чтобы смещения не съезжали).
 *
 * Преимущество: весь раздел форматирования (<w:rPr>, гиперссылки, закладки)
 * остаётся нетронутым — мы трогаем только текст внутри <w:t>…</w:t>.
 *
 * Зависит от: JSZip (глобальная переменная, должен быть загружен первым).
 */
'use strict';

// XML-файлы внутри .docx, которые обрабатываем
const PART_PATTERNS = [
  /^word\/document\.xml$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/,
  /^word\/comments\.xml$/,
];

// ---------------------------------------------------------------------------
// Загрузка .docx
// ---------------------------------------------------------------------------

/**
 * Распаковывает .docx и возвращает XML-строки нужных частей.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{zip, parts: Object<string, string>}>}
 *   parts: { 'word/document.xml': '<?xml ...>', ... }
 */
async function parseDocx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    throw new Error(
      'Не удалось открыть файл. Возможно, файл зашифрован, повреждён или не является .docx.'
    );
  }

  const partNames = Object.keys(zip.files).filter(name =>
    PART_PATTERNS.some(p => p.test(name))
  );

  if (!partNames.includes('word/document.xml')) {
    throw new Error('Файл не является корректным .docx (отсутствует word/document.xml).');
  }

  const parts = {};
  for (const name of partNames) {
    const file = zip.file(name);
    if (!file) continue;
    try {
      parts[name] = await file.async('string');
    } catch (_) {
      // нечитаемые части пропускаем
    }
  }

  return { zip, parts };
}

// ---------------------------------------------------------------------------
// Разбор параграфов и <w:t>-элементов
// ---------------------------------------------------------------------------

/**
 * Находит все параграфы <w:p> в XML-строке.
 * Возвращает массив {paraXml, absStart, absEnd}.
 *
 * ВАЖНО: регулярка не обрабатывает вложенные <w:p> (в таблицах они
 * тоже встречаются как отдельные совпадения — что нам и нужно).
 */
function findParagraphs(xmlStr) {
  // Ленивый матч: <w:p> до первого </w:p>
  // Этот подход корректен, поскольку <w:p> не вкладываются друг в друга
  const RE = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const result = [];
  let m;
  while ((m = RE.exec(xmlStr)) !== null) {
    result.push({ paraXml: m[0], absStart: m.index, absEnd: m.index + m[0].length });
  }
  return result;
}

/**
 * Находит все <w:t> в строке параграфа.
 * Возвращает массив tElement:
 * {
 *   text,          — текстовое содержимое
 *   absTextStart,  — позиция первого символа text в полном xmlStr
 *   absTextEnd,    — позиция после последнего символа text в xmlStr
 *   openTag,       — строка открывающего тега (<w:t> или <w:t xml:space="preserve">)
 *   absTagStart,   — позиция открывающего тега в xmlStr
 * }
 */
function findTElements(paraXml, paraAbsStart) {
  // Матч: открывающий тег <w:t ...> + текст + закрывающий тег </w:t>
  // Текст внутри <w:t> никогда не содержит '<' (иначе это невалидный XML,
  // которого Word не генерирует), поэтому [^<]* безопасен.
  const RE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
  const elements = [];
  let m;
  while ((m = RE.exec(paraXml)) !== null) {
    const openTag      = m[1];
    const text         = m[2];
    const localTagStart = m.index;
    const localTextStart = m.index + openTag.length;

    elements.push({
      text,
      openTag,
      absTagStart:  paraAbsStart + localTagStart,
      absTextStart: paraAbsStart + localTextStart,
      absTextEnd:   paraAbsStart + localTextStart + text.length,
    });
  }
  return elements;
}

/**
 * Строит виртуальный текст параграфа и карту позиций.
 * charMap[i] = { tIdx, localOffset }
 */
function buildVirtualText(tElements) {
  let virtualText = '';
  const charMap = [];

  for (let tIdx = 0; tIdx < tElements.length; tIdx++) {
    const text = tElements[tIdx].text;
    for (let j = 0; j < text.length; j++) {
      charMap.push({ tIdx, localOffset: j });
    }
    virtualText += text;
  }

  return { virtualText, charMap };
}

// ---------------------------------------------------------------------------
// Получение всех параграфов документа
// ---------------------------------------------------------------------------

/**
 * Возвращает плоский список параграфов по всем XML-частям.
 * @param {Object<string,string>} parts
 * @returns {Array<{partName, paraIdx, paraXml, absStart, absEnd, tElements, virtualText, charMap}>}
 */
function getAllParagraphs(parts) {
  const result = [];

  for (const [partName, xmlStr] of Object.entries(parts)) {
    const paras = findParagraphs(xmlStr);
    paras.forEach((para, paraIdx) => {
      const tElements = findTElements(para.paraXml, para.absStart);
      const { virtualText, charMap } = buildVirtualText(tElements);
      if (virtualText.trim()) {
        result.push({
          partName,
          paraIdx,
          paraXml:  para.paraXml,
          absStart: para.absStart,
          absEnd:   para.absEnd,
          tElements,
          virtualText,
          charMap,
        });
      }
    });
  }

  return result;
}

/**
 * Возвращает полный текст document.xml (параграфы через \n).
 */
function getFullDocumentText(parts) {
  const xmlStr = parts['word/document.xml'];
  if (!xmlStr) return '';

  const paras = findParagraphs(xmlStr);
  return paras.map(p => {
    const tEls = findTElements(p.paraXml, p.absStart);
    return tEls.map(t => t.text).join('');
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Применение замен
// ---------------------------------------------------------------------------

/**
 * Применяет замены к XML-частям и обновляет zip.
 *
 * @param {Object} zip — JSZip-объект
 * @param {Object<string,string>} parts — XML-строки частей
 * @param {Array<{partName,paraIdx,start,end,replacementText,enabled}>} entityReplacements
 * @returns {Promise<Object>} обновлённый zip
 */
async function applyEntityReplacements(zip, parts, entityReplacements) {
  // Группируем: partName → paraIdx → список замен
  const byPart = {};
  for (const er of entityReplacements) {
    if (er.enabled === false) continue;
    if (!byPart[er.partName]) byPart[er.partName] = {};
    if (!byPart[er.partName][er.paraIdx]) byPart[er.partName][er.paraIdx] = [];
    byPart[er.partName][er.paraIdx].push(er);
  }

  for (const [partName, partXml] of Object.entries(parts)) {
    const paraGroups = byPart[partName];
    if (!paraGroups) continue;

    // Собираем все правки для этой части (в координатах полного XML-string)
    const allEdits = [];

    const paras = findParagraphs(partXml);

    for (const [paraIdxStr, replacements] of Object.entries(paraGroups)) {
      const paraIdx = parseInt(paraIdxStr, 10);
      const para = paras[paraIdx];
      if (!para) continue;

      const tElements = findTElements(para.paraXml, para.absStart);
      const { charMap } = buildVirtualText(tElements);

      const sorted = [...replacements].sort((a, b) => a.start - b.start);
      const edits  = buildEdits(tElements, charMap, sorted);
      allEdits.push(...edits);
    }

    if (allEdits.length === 0) continue;

    // Применяем все правки к строке в обратном порядке (избегаем смещений)
    const newXml = applyEdits(partXml, allEdits);
    parts[partName] = newXml;
    zip.file(partName, newXml);
  }

  return zip;
}

/**
 * Для набора замен в одном параграфе строит список правок над XML-строкой.
 */
function buildEdits(tElements, charMap, sortedReplacements) {
  const edits = [];

  // Предвычислим смещения начала каждого tElement в virtualText
  const tVStart = [];
  let vPos = 0;
  for (const te of tElements) {
    tVStart.push(vPos);
    vPos += te.text.length;
  }
  const totalLen = vPos;

  for (const repl of sortedReplacements) {
    const { start, end, replacementText } = repl;
    if (start >= end || start >= totalLen) continue;

    let replacementInserted = false;

    for (let tIdx = 0; tIdx < tElements.length; tIdx++) {
      const te     = tElements[tIdx];
      const tStart = tVStart[tIdx];
      const tEnd   = tStart + te.text.length;

      // Элемент не попадает в диапазон сущности
      if (tEnd <= start || tStart >= end) continue;

      // Позиция внутри текста этого элемента
      const localFrom = Math.max(0, start - tStart);
      const localTo   = Math.min(te.text.length, end - tStart);

      const absFrom = te.absTextStart + localFrom;
      const absTo   = te.absTextStart + localTo;

      if (!replacementInserted) {
        // Первый затронутый элемент: заменяем фрагмент на replacement
        edits.push({ absStart: absFrom, absEnd: absTo, newText: replacementText });
        replacementInserted = true;
      } else {
        // Последующие элементы: просто вырезаем
        edits.push({ absStart: absFrom, absEnd: absTo, newText: '' });
      }
    }
  }

  return edits;
}

/**
 * Применяет список правок к строке (справа налево, чтобы смещения не съезжали).
 * Перекрывающиеся правки игнорируются.
 */
function applyEdits(xmlStr, edits) {
  // Сортируем по убыванию absStart, при равных — по убыванию absEnd
  edits.sort((a, b) => b.absStart !== a.absStart ? b.absStart - a.absStart : b.absEnd - a.absEnd);

  let result = xmlStr;
  let lastStart = Infinity;

  for (const edit of edits) {
    // Пропускаем перекрывающиеся правки
    if (edit.absEnd > lastStart) continue;
    result    = result.slice(0, edit.absStart) + edit.newText + result.slice(edit.absEnd);
    lastStart = edit.absStart;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Поддержка подсветки при разметке
// ---------------------------------------------------------------------------

/**
 * Находит все <w:r> элементы в параграфе с их свойствами и вложенными <w:t>.
 */
function findRunsWithTElements(paraXml, paraAbsStart) {
  const RE_RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = RE_RUN.exec(paraXml)) !== null) {
    const runXml = m[0];
    const absRunStart = paraAbsStart + m.index;
    const absRunEnd   = absRunStart + runXml.length;
    const rPrMatch    = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPrInner    = rPrMatch ? rPrMatch[1] : '';
    const tEls        = findTElements(runXml, absRunStart);
    runs.push({ absRunStart, absRunEnd, rPrInner, tEls, vStart: 0, vEnd: 0 });
  }
  return runs;
}

/**
 * Строит XML одного <w:r>. Если highlightFill задан — добавляет <w:shd> с этим цветом.
 * @param {string}      rPrInner     — содержимое <w:rPr> (без самого тега)
 * @param {string}      text         — текстовое содержимое <w:t> (уже корректный XML-текст)
 * @param {string|null} highlightFill — hex-цвет заливки или null
 */
function buildRunXml(rPrInner, text, highlightFill) {
  let rPrContent = rPrInner;
  if (highlightFill) {
    // Удаляем существующий <w:shd> чтобы не дублировать
    const cleaned = rPrInner
      .replace(/<w:shd[^/]*\/>/g, '')
      .replace(/<w:shd[\s\S]*?<\/w:shd>/g, '');
    rPrContent = cleaned + `<w:shd w:val="clear" w:color="auto" w:fill="${highlightFill}"/>`;
  }
  const rPrXml     = rPrContent ? `<w:rPr>${rPrContent}</w:rPr>` : '';
  const needsSpace = /^\s|\s$/.test(text);
  const wtAttr     = needsSpace ? ' xml:space="preserve"' : '';
  return `<w:r>${rPrXml}<w:t${wtAttr}>${text}</w:t></w:r>`;
}

/**
 * Строит XML-правки для одного параграфа в режиме разметки с подсветкой.
 * Возвращает массив правок (absStart, absEnd, newText) для applyEdits.
 *
 * @param {string}  paraXml        — XML параграфа
 * @param {number}  paraAbsStart   — абсолютная позиция параграфа в полном XML
 * @param {Array}   sortedEntities — сущности, отсортированные по start (возр.)
 * @param {string}  highlightFill  — hex-цвет подсветки (напр. '90EE90')
 */
function buildMarkupEditsForPara(paraXml, paraAbsStart, sortedEntities, highlightFill) {
  const runs = findRunsWithTElements(paraXml, paraAbsStart);
  if (!runs.length) return [];

  // Строим виртуальные позиции для всех tElement-ов по всем runs
  const allTEls = [];
  let vPos = 0;
  for (const run of runs) {
    run.vStart = vPos;
    for (const te of run.tEls) {
      allTEls.push({ te, run, vStart: vPos, vEnd: vPos + te.text.length });
      vPos += te.text.length;
    }
    run.vEnd = vPos;
  }
  const totalLen = vPos;
  if (!totalLen) return [];

  // Назначаем каждой сущности индексы затронутых runs
  const entityInfo = sortedEntities.map(entity => {
    const start = entity.start;
    const end   = Math.min(entity.end, totalLen);
    if (start >= end) return null;
    let fi = -1, li = -1;
    for (let ri = 0; ri < runs.length; ri++) {
      const r = runs[ri];
      if (r.vStart < end && r.vEnd > start) {
        if (fi === -1) fi = ri;
        li = ri;
      }
    }
    if (fi === -1) return null;
    return { entity, start, end, fi, li };
  }).filter(Boolean);

  if (!entityInfo.length) return [];

  // Объединяем сущности, которые делят хотя бы один run
  const groups = [];
  let g         = [entityInfo[0]];
  let groupMaxLi = entityInfo[0].li;

  for (let i = 1; i < entityInfo.length; i++) {
    const curr = entityInfo[i];
    if (curr.fi <= groupMaxLi) {
      g.push(curr);
      if (curr.li > groupMaxLi) groupMaxLi = curr.li;
    } else {
      groups.push(g);
      g = [curr];
      groupMaxLi = curr.li;
    }
  }
  groups.push(g);

  const edits = [];

  for (const group of groups) {
    const gfi       = group[0].fi;
    const gli       = Math.max(...group.map(x => x.li));
    const firstRun  = runs[gfi];
    const lastRun   = runs[gli];
    const groupVStart = firstRun.vStart;
    const groupVEnd   = lastRun.vEnd;

    // Строим список сегментов: обычный текст | сущность (с подсветкой)
    const segments = [];
    let cur = groupVStart;
    for (const { entity, start, end } of group) {
      const s = Math.max(start, groupVStart);
      const e = Math.min(end, groupVEnd);
      if (cur < s) segments.push({ vStart: cur, vEnd: s, isEntity: false });
      segments.push({ vStart: s, vEnd: e, isEntity: true, entity });
      cur = e;
    }
    if (cur < groupVEnd) segments.push({ vStart: cur, vEnd: groupVEnd, isEntity: false });

    // Генерируем XML для каждого сегмента
    let newXml = '';
    for (const seg of segments) {
      if (seg.isEntity) {
        const runAtStart = allTEls.find(i => i.vStart <= seg.vStart && i.vEnd > seg.vStart)?.run
          || firstRun;
        newXml += buildRunXml(runAtStart.rPrInner, seg.entity.replacementText, highlightFill);
      } else {
        // Обычный текст — сохраняем исходное форматирование (по runs)
        let prevRun = null, buf = '';
        for (const info of allTEls) {
          if (info.vEnd <= seg.vStart || info.vStart >= seg.vEnd) continue;
          const lStart = Math.max(0, seg.vStart - info.vStart);
          const lEnd   = Math.min(info.te.text.length, seg.vEnd - info.vStart);
          const txt    = info.te.text.slice(lStart, lEnd);
          if (!txt) continue;
          if (prevRun && prevRun !== info.run) {
            newXml += buildRunXml(prevRun.rPrInner, buf, null);
            buf = '';
          }
          prevRun = info.run;
          buf    += txt;
        }
        if (buf && prevRun) newXml += buildRunXml(prevRun.rPrInner, buf, null);
      }
    }

    edits.push({ absStart: firstRun.absRunStart, absEnd: lastRun.absRunEnd, newText: newXml });
  }

  return edits;
}

/**
 * Аналог applyEntityReplacements для режима разметки с подсветкой.
 * Вместо текстовых правок создаёт run-уровневые правки с <w:shd>.
 *
 * @param {Object}  zip                — JSZip-объект
 * @param {Object}  parts              — XML-строки частей
 * @param {Array}   entityReplacements — сущности с полем replacementText
 * @param {string}  highlightFill      — hex-цвет подсветки
 */
async function applyMarkupWithHighlights(zip, parts, entityReplacements, highlightFill) {
  const byPart = {};
  for (const er of entityReplacements) {
    if (er.enabled === false) continue;
    if (!byPart[er.partName]) byPart[er.partName] = {};
    if (!byPart[er.partName][er.paraIdx]) byPart[er.partName][er.paraIdx] = [];
    byPart[er.partName][er.paraIdx].push(er);
  }

  for (const [partName, partXml] of Object.entries(parts)) {
    const paraGroups = byPart[partName];
    if (!paraGroups) continue;

    const allEdits = [];
    const paras    = findParagraphs(partXml);

    for (const [paraIdxStr, replacements] of Object.entries(paraGroups)) {
      const paraIdx = parseInt(paraIdxStr, 10);
      const para    = paras[paraIdx];
      if (!para) continue;

      const sorted = [...replacements].sort((a, b) => a.start - b.start);
      const edits  = buildMarkupEditsForPara(para.paraXml, para.absStart, sorted, highlightFill);
      allEdits.push(...edits);
    }

    if (!allEdits.length) continue;
    const newXml = applyEdits(partXml, allEdits);
    parts[partName] = newXml;
    zip.file(partName, newXml);
  }

  return zip;
}

// ---------------------------------------------------------------------------
// Сериализация
// ---------------------------------------------------------------------------

/**
 * Упаковывает модифицированный zip в ArrayBuffer.
 */
async function serializeDocx(zip) {
  return zip.generateAsync({
    type:               'arraybuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
