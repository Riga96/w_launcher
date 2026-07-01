/**
 * parser.js — URL parsing, path building, and blacktoon domain helpers.
 *
 * Opening URLs always use http://blacktoon{siteNumber}.com + saved path.
 * Only the site number changes; episode paths stay fixed.
 */

/**
 * Extract blacktoon site number from a hostname.
 * Accepts blacktoon415.com and www.blacktoon415.com
 * @param {string} host
 * @returns {number | null}
 */
export function extractSiteNumber(host) {
  const normalized = (host || '').replace(/^www\./i, '');
  const match = normalized.match(/^blacktoon(\d+)\.com$/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Build blacktoon hostname from site number.
 * @param {number} siteNumber
 * @returns {string}
 */
export function buildBlacktoonDomain(siteNumber) {
  return `blacktoon${siteNumber}.com`;
}

/**
 * Build episode pathname.
 * @param {string} category
 * @param {string} workId
 * @param {string} episodeId
 * @returns {string}
 */
export function buildPath(category, workId, episodeId) {
  return `/${category}/${workId}/${episodeId}.html`;
}

/**
 * Build the URL used to open an episode (always http, no www).
 * @param {number} siteNumber
 * @param {string} path
 * @returns {string}
 */
export function buildOpenUrl(siteNumber, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `http://${buildBlacktoonDomain(siteNumber)}${normalizedPath}`;
}

/**
 * Build path for a bookmark, falling back to legacy fields.
 * @param {object} bookmark
 * @returns {string}
 */
export function getBookmarkPath(bookmark) {
  if (bookmark.path) return bookmark.path;
  const category = bookmark.category || 'webtoons';
  return buildPath(category, bookmark.workId, bookmark.episodeId);
}

/**
 * Build open URL for a bookmark using the current site number.
 * @param {object} bookmark
 * @param {number} siteNumber
 * @returns {string}
 */
export function buildBookmarkOpenUrl(bookmark, siteNumber) {
  return buildOpenUrl(siteNumber, getBookmarkPath(bookmark));
}

/**
 * Build path for a specific episode on an existing bookmark.
 * @param {object} bookmark
 * @param {string} episodeId
 * @returns {string}
 */
export function buildPathForEpisode(bookmark, episodeId) {
  const category = bookmark.category || 'webtoons';
  return buildPath(category, bookmark.workId, episodeId);
}

/**
 * Parse a raw webtoon URL into structured parts.
 * @param {string} raw
 * @returns {object | null}
 */
export function parseWebtoonUrl(raw) {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\./i, '');
    const segments = url.pathname.split('/').filter(Boolean);
    const category = segments[0] || '';
    const workId = segments[1] || '';
    const episodeId = (segments[2] || '').replace(/\.html?$/i, '');
    if (!category || !workId || !episodeId) return null;

    const siteNumber = extractSiteNumber(host);
    const path = buildPath(category, workId, episodeId);

    return {
      domain: host,
      host,
      siteNumber,
      category,
      workId,
      episodeId,
      path,
      lastUrl: raw.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Parse a clipboard webtoon URL (strict webtoons path).
 * Accepts http/https and www prefix.
 * @param {string} raw
 * @returns {object | null}
 */
export function parseClipboardWebtoonUrl(raw) {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\./i, '');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 3) return null;

    const [category, workId, episodeFile] = segments;
    if (category !== 'webtoons') return null;

    const episodeId = episodeFile.replace(/\.html?$/i, '');
    if (!workId || !episodeId) return null;

    const siteNumber = extractSiteNumber(host);
    const path = buildPath('webtoons', workId, episodeId);

    return {
      domain: host,
      host,
      siteNumber,
      category: 'webtoons',
      workId,
      episodeId,
      path,
      lastUrl: raw.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Normalize a domain string by stripping protocol, www, and path segments.
 * @param {string} value
 * @returns {string}
 */
export function normDomain(value) {
  return (value || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '');
}

/**
 * Default auto-generated title for a new work.
 * @param {string} workId
 * @returns {string}
 */
export function defaultWorkTitle(workId) {
  return `webtoons-${workId}`;
}

/**
 * Validate nickname length (2–4 chars when provided).
 * @param {string} nickname
 * @returns {boolean}
 */
export function isValidNickname(nickname) {
  if (!nickname) return true;
  const len = nickname.length;
  return len >= 2 && len <= 4;
}

/**
 * Find a bookmark that matches the parsed URL's category and workId.
 * @param {Array} bookmarks
 * @param {{ category: string, workId: string }} parsed
 * @returns {object | undefined}
 */
export function findBookmarkByWork(bookmarks, parsed) {
  return bookmarks.find(
    (b) => b.category === parsed.category && b.workId === parsed.workId
  );
}

/** @deprecated Use buildOpenUrl — kept for legacy call sites during migration */
export function makeUrl(domain, category, workId, episodeId) {
  const siteNumber = extractSiteNumber(domain.replace(/^www\./i, ''));
  const path = buildPath(category, workId, episodeId);
  if (siteNumber != null) return buildOpenUrl(siteNumber, path);
  return `http://${domain.replace(/^www\./i, '')}${path}`;
}
