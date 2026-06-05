/**
 * replacer.js
 * Логика замены найденных сущностей.
 * Поддерживает три режима: placeholder, mask, delete.
 * Консистентность: одно значение → один плейсхолдер по всему документу.
 */
'use strict';

class Replacer {
  constructor(mode) {
    this.mode = mode; // 'placeholder' | 'mask' | 'delete'
    /** @type {Map<string, string>} normalizedValue → placeholderText */
    this.consistencyMap = new Map();
    /** @type {Map<string, number>} category → счётчик */
    this.counters = {};
  }

  /**
   * Вычисляет текст замены для сущности.
   * Использует consistencyMap для повторяющихся значений.
   * @param {string} value  - оригинальный текст
   * @param {string} category - ключ категории
   * @returns {string}
   */
  getReplacement(value, category) {
    const key = `${category}::${value.trim().toLowerCase()}`;

    if (this.mode === 'placeholder') {
      if (this.consistencyMap.has(key)) {
        return this.consistencyMap.get(key);
      }
      const n = (this.counters[category] = (this.counters[category] || 0) + 1);
      const prefix = (typeof CATEGORIES !== 'undefined' && CATEGORIES[category])
        ? CATEGORIES[category].placeholder
        : category;
      const placeholder = `[${prefix}_${n}]`;
      this.consistencyMap.set(key, placeholder);
      return placeholder;
    }

    if (this.mode === 'mask') {
      return 'X'.repeat(value.length);
    }

    if (this.mode === 'delete') {
      return '';
    }

    return value;
  }

  /**
   * Возвращает маппинг плейсхолдер → оригинал для экспорта.
   * @returns {Object}
   */
  exportMapping() {
    const result = {};
    for (const [key, placeholder] of this.consistencyMap.entries()) {
      const original = key.slice(key.indexOf('::') + 2);
      result[placeholder] = original;
    }
    return result;
  }

  /**
   * Предвычисляет replacementText для массива сущностей.
   * Мутирует entities (добавляет поле replacementText).
   * @param {Array<{value,category}>} entities
   */
  precompute(entities) {
    for (const entity of entities) {
      entity.replacementText = this.getReplacement(entity.value, entity.category);
    }
  }

  /**
   * Применяет список замен (уже с replacementText) к тексту параграфа.
   * Используется для unit-тестирования.
   * @param {string} text
   * @param {Array<{start,end,replacementText,enabled}>} entities
   * @returns {string}
   */
  static applyToText(text, entities) {
    const active = entities
      .filter(e => e.enabled !== false)
      .sort((a, b) => b.start - a.start); // от конца, чтобы смещения не съезжали

    let result = text;
    for (const e of active) {
      result = result.slice(0, e.start) + e.replacementText + result.slice(e.end);
    }
    return result;
  }
}
