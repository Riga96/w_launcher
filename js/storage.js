/**
 * storage.js — localStorage persistence, settings, migration, import/export.
 *
 * Bookmarks use key webtoon_bookmarks_v1 (unchanged).
 * Global currentSiteNumber lives in webtoon_settings_v1.
 */

import {
  buildPath,
  extractSiteNumber,
  normDomain,
} from './parser.js?v=2.1.2';

/** @type {string} Unchanged storage key — do not rename. */
export const STORAGE_KEY = 'webtoon_bookmarks_v1';

/** @type {string} Settings storage key. */
export const SETTINGS_KEY = 'webtoon_settings_v1';

/**
 * Default values for fields added in newer versions.
 * Only applied when a field is missing; existing values are never overwritten.
 */
const BOOKMARK_DEFAULTS = {
  favorite: false,
  history: [],
  nickname: '',
  badgeColor: '',
  path: '',
  lastUrl: '',
  displayEpisode: '',
};

/**
 * Migrate a single bookmark to the current schema.
 * @param {object} bookmark
 * @returns {object}
 */
export function migrateBookmark(bookmark) {
  const migrated = { ...bookmark };

  for (const [key, defaultValue] of Object.entries(BOOKMARK_DEFAULTS)) {
    if (migrated[key] === undefined || migrated[key] === null) {
      migrated[key] = Array.isArray(defaultValue) ? [] : defaultValue;
    }
  }

  if (!migrated.path && migrated.workId && migrated.episodeId) {
    const category = migrated.category || 'webtoons';
    migrated.path = buildPath(category, migrated.workId, migrated.episodeId);
  }

  if (!migrated.updatedAt) {
    migrated.updatedAt = new Date().toISOString();
  }

  // Clear displayEpisode if it looks like an internal URL episode ID.
  migrated.displayEpisode = normalizeDisplayEpisode(migrated.displayEpisode, migrated.episodeId);

  return migrated;
}

/**
 * Normalize displayEpisode before saving to localStorage.
 * @param {string} value
 * @param {string} episodeId
 * @returns {string}
 */
function normalizeDisplayEpisode(value, episodeId) {
  const trimmed = String(value ?? '').trim();
  const id = String(episodeId || '').trim();
  if (!trimmed) return '';
  if (id && (trimmed === id || trimmed === `${id}화`)) return '';
  if (/^\d{6,}화?$/.test(trimmed)) return '';
  return trimmed;
}

/**
 * Migrate an array of bookmarks.
 * @param {Array} bookmarks
 * @returns {Array}
 */
export function migrateAll(bookmarks) {
  return bookmarks.map(migrateBookmark);
}

/**
 * Whether a bookmark record is missing fields from the current schema.
 * @param {object} bookmark
 * @returns {boolean}
 */
function bookmarkNeedsMigration(bookmark) {
  if (!bookmark.updatedAt) return true;
  if (!bookmark.path && bookmark.workId && bookmark.episodeId) return true;
  if (bookmark.displayEpisode === undefined || bookmark.displayEpisode === null) return true;
  const sanitized = normalizeDisplayEpisode(bookmark.displayEpisode, bookmark.episodeId);
  if (sanitized !== String(bookmark.displayEpisode ?? '').trim()) return true;
  return Object.keys(BOOKMARK_DEFAULTS).some(
    (key) => bookmark[key] === undefined || bookmark[key] === null
  );
}

/**
 * Load app settings from localStorage.
 * @returns {{ currentSiteNumber?: number }}
 */
export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Save app settings to localStorage.
 * @param {object} settings
 */
export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Get the current blacktoon site number.
 * @returns {number | null}
 */
export function getCurrentSiteNumber() {
  const { currentSiteNumber } = loadSettings();
  return typeof currentSiteNumber === 'number' ? currentSiteNumber : null;
}

/**
 * Set and persist the current blacktoon site number.
 * @param {number} siteNumber
 */
export function setCurrentSiteNumber(siteNumber) {
  saveSettings({ ...loadSettings(), currentSiteNumber: siteNumber });
}

/**
 * Infer currentSiteNumber from bookmark domains if not yet set.
 * @param {Array} bookmarks
 * @returns {number | null}
 */
export function inferSiteNumberFromBookmarks(bookmarks) {
  for (const bookmark of bookmarks) {
    const fromDomain = extractSiteNumber(normDomain(bookmark.domain));
    if (fromDomain != null) return fromDomain;

    if (bookmark.lastUrl) {
      try {
        const host = new URL(bookmark.lastUrl).hostname.replace(/^www\./i, '');
        const fromLast = extractSiteNumber(host);
        if (fromLast != null) return fromLast;
      } catch {
        /* ignore invalid lastUrl */
      }
    }
  }
  return null;
}

/**
 * Load bookmarks from localStorage with automatic migration.
 * @returns {Array}
 */
export function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || '[]';
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const migrated = migrateAll(parsed);

    if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }

    return migrated;
  } catch {
    return [];
  }
}

/**
 * Initialize settings, migrating site number from legacy bookmark domains.
 * @param {Array} bookmarks
 * @returns {number | null}
 */
export function initSettings(bookmarks) {
  const settings = loadSettings();
  if (typeof settings.currentSiteNumber === 'number') {
    return settings.currentSiteNumber;
  }

  const inferred = inferSiteNumberFromBookmarks(bookmarks);
  if (inferred != null) {
    setCurrentSiteNumber(inferred);
    return inferred;
  }

  return null;
}

/**
 * Save bookmarks to localStorage.
 * @param {Array} bookmarks
 */
export function saveBookmarks(bookmarks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

/**
 * Add or update a history entry for an episode visit.
 * @param {Array} history
 * @param {{ episodeId: string, url: string, viewedAt: string }} entry
 * @returns {Array}
 */
export function upsertHistory(history, entry) {
  const idx = history.findIndex((h) => h.episodeId === entry.episodeId);
  if (idx === -1) return [...history, entry];
  const copy = [...history];
  copy[idx] = { ...copy[idx], url: entry.url, viewedAt: entry.viewedAt };
  return copy;
}

/**
 * Generate a unique bookmark id.
 * @returns {string}
 */
export function createBookmarkId() {
  return Date.now().toString(36);
}

/**
 * Create a new bookmark object with defaults and initial history.
 * @param {object} fields
 * @returns {object}
 */
export function createBookmark(fields) {
  const now = new Date().toISOString();
  return migrateBookmark({
    id: createBookmarkId(),
    updatedAt: now,
    history: [],
    favorite: false,
    nickname: '',
    badgeColor: '',
    path: '',
    lastUrl: '',
    ...fields,
  });
}

/**
 * Apply a new domain to every bookmark (bulk domain switch).
 * Updates path only when domain contains a blacktoon site number.
 * @param {Array} bookmarks
 * @param {string} domain
 * @returns {Array}
 */
export function applyBulkDomain(bookmarks, domain) {
  const now = new Date().toISOString();
  const normalized = normDomain(domain);
  return bookmarks.map((b) => ({
    ...b,
    domain: normalized,
    updatedAt: now,
  }));
}

/**
 * Merge imported bookmarks with existing data or replace entirely.
 * @param {Array} existing
 * @param {Array} imported
 * @param {boolean} merge
 * @returns {Array}
 */
export function mergeImportedBookmarks(existing, imported, merge) {
  const migrated = migrateAll(imported);
  if (!merge) return migrated;
  return [
    ...migrated,
    ...existing.filter((item) => !migrated.some((i) => i.id === item.id)),
  ];
}

/**
 * Download bookmarks as a JSON backup file.
 * @param {Array} bookmarks
 */
export function exportBookmarksJson(bookmarks) {
  const blob = new Blob([JSON.stringify(bookmarks, null, 2)], {
    type: 'application/json',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'webtoon-bookmarks.json';
  anchor.click();
}

/**
 * Parse a JSON backup file into bookmark objects.
 * @param {string} text
 * @returns {Array}
 */
export function parseImportJson(text) {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('Invalid format');
  return migrateAll(arr);
}
