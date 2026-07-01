/**
 * launcher.js — Episode open actions using currentSiteNumber + saved path.
 *
 * Opening never auto-increments episodeId for "current".
 * Only the blacktoon site number in the domain changes at open time.
 */

import {
  buildOpenUrl,
  buildPathForEpisode,
  getBookmarkPath,
} from './parser.js';
import { upsertHistory } from './storage.js';

/**
 * Resolve the target episode id for prev/next navigation.
 * @param {string} currentEpisodeId
 * @param {'next' | 'prev'} action
 * @returns {string | null}
 */
export function resolveEpisodeId(currentEpisodeId, action) {
  const num = parseInt(currentEpisodeId, 10);
  if (isNaN(num)) return currentEpisodeId;

  if (action === 'next') return String(num + 1);
  if (action === 'prev') {
    if (num <= 1) return null;
    return String(num - 1);
  }

  return currentEpisodeId;
}

/**
 * Whether the previous-episode button should be enabled.
 * @param {string} episodeId
 * @returns {boolean}
 */
export function canGoPrevious(episodeId) {
  const num = parseInt(episodeId, 10);
  return !isNaN(num) && num > 1;
}

/**
 * Human-readable toast label for a launch action.
 * @param {'current' | 'next' | 'prev' | 'site-plus'} action
 * @param {string} episodeId
 * @returns {string}
 */
export function getLaunchLabel(action, episodeId) {
  if (action === 'current') return `${episodeId}화 읽기 시작`;
  if (action === 'site-plus') return `사이트 번호 변경 후 ${episodeId}화 열기`;
  return `${episodeId}화로 이동`;
}

/**
 * Record a visit in bookmark history without changing episode/path.
 * @param {object} bookmark
 * @param {number} siteNumber
 * @param {string} openUrl
 */
function recordVisit(bookmark, siteNumber, openUrl) {
  const now = new Date().toISOString();
  bookmark.updatedAt = now;
  bookmark.lastUrl = openUrl;
  bookmark.domain = `blacktoon${siteNumber}.com`;
  bookmark.history = upsertHistory(bookmark.history, {
    episodeId: bookmark.episodeId,
    url: openUrl,
    viewedAt: now,
  });
}

/**
 * Open the saved path as-is (no episodeId change).
 * @param {object} bookmark
 * @param {number} siteNumber
 * @returns {{ url: string, label: string } | null}
 */
export function openCurrent(bookmark, siteNumber) {
  if (siteNumber == null) return null;

  const url = buildOpenUrl(siteNumber, getBookmarkPath(bookmark));
  recordVisit(bookmark, siteNumber, url);

  return {
    url,
    label: getLaunchLabel('current', bookmark.episodeId),
  };
}

/**
 * Navigate to prev/next episode, updating path and episodeId.
 * @param {object} bookmark
 * @param {number} siteNumber
 * @param {'next' | 'prev'} action
 * @returns {{ url: string, label: string, episodeId: string } | null}
 */
export function openAdjacent(bookmark, siteNumber, action) {
  if (siteNumber == null) return null;

  const episodeId = resolveEpisodeId(bookmark.episodeId, action);
  if (episodeId === null) return null;

  const path = buildPathForEpisode(bookmark, episodeId);
  const url = buildOpenUrl(siteNumber, path);
  const now = new Date().toISOString();

  bookmark.episodeId = episodeId;
  bookmark.path = path;
  bookmark.updatedAt = now;
  bookmark.lastUrl = url;
  bookmark.domain = `blacktoon${siteNumber}.com`;
  bookmark.history = upsertHistory(bookmark.history, {
    episodeId,
    url,
    viewedAt: now,
  });

  return { url, label: getLaunchLabel(action, episodeId), episodeId };
}

/**
 * Open a URL in a new tab with safe referrer policy.
 * @param {string} url
 */
export function openInNewTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
