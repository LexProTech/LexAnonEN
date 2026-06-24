/**
 * validators.js
 * Checksum validators for document identifiers.
 *
 * English-only build: no Russian identifiers (INN/OGRN/BIK/KPP) are detected,
 * so no checksum validators are required here. The file is kept (and loaded via
 * importScripts) as the place to add validators for future English-locale
 * identifiers if needed. entity-finder.js's collect() still accepts an optional
 * `validator` callback per pattern.
 */
'use strict';
