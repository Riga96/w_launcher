/**
 * launcher.js — Open saved episode URLs using currentSiteNumber + saved path.
 *
 * Episode IDs are opaque and random — never increment or predict next episodes.
 * This module only opens the exact path stored on each bookmark.
 */

import { buildOpenUrl, getBookmarkPath } from './parser.js?v=2.1.3';

/**
 * Build the open URL for a bookmark without modifying stored data.
 * @param {object} bookmark
 * @param {number} siteNumber
 * @returns {{ url: string, label: string } | null}
 */
export function openSaved(bookmark, siteNumber) {
  if (siteNumber == null) return null;

  return {
    url: buildOpenUrl(siteNumber, getBookmarkPath(bookmark)),
    label: '저장된 화 열기',
  };
}

/**
 * Open a URL in a new tab with safe referrer policy.
 * @param {string} url
 */
export function openInNewTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** @deprecated Use openSaved */
export function openCurrent(bookmark, siteNumber) {
  return openSaved(bookmark, siteNumber);
}
