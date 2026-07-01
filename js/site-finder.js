/**
 * site-finder.js — Auto-detect working blacktoon site number.
 *
 * Probes http://blacktoon{number}.com using fetch (no-cors) with image fallback.
 * DNS/network failures are treated as non-working; opaque fetch success counts as reachable.
 */

import { buildBlacktoonDomain } from './parser.js?v=2.0.6';

const PROBE_TIMEOUT_MS = 5000;
const DEFAULT_RANGE = 10;

/**
 * Probe a site URL with fetch no-cors.
 * @param {string} url
 * @returns {Promise<'ok' | 'fail'>}
 */
async function probeWithFetch(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return 'ok';
  } catch {
    return 'fail';
  }
}

/**
 * Secondary probe via favicon image load (helps when fetch is inconclusive).
 * @param {number} siteNumber
 * @returns {Promise<boolean>}
 */
function probeWithImage(siteNumber) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      resolve(false);
    }, PROBE_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };

    img.src = `http://${buildBlacktoonDomain(siteNumber)}/favicon.ico?probe=${Date.now()}`;
  });
}

/**
 * Test whether a blacktoon site number appears reachable.
 * @param {number} siteNumber
 * @returns {Promise<boolean>}
 */
async function isSiteReachable(siteNumber) {
  const baseUrl = `http://${buildBlacktoonDomain(siteNumber)}/`;
  const fetchResult = await probeWithFetch(baseUrl);
  if (fetchResult === 'fail') return false;

  const imageResult = await probeWithImage(siteNumber);
  return fetchResult === 'ok' || imageResult;
}

/**
 * Scan a range of site numbers starting from startNumber.
 * @param {number} startNumber
 * @param {number} [range=10] — inclusive offset (start .. start+range)
 * @returns {Promise<{ found: number | null, blocked: boolean }>}
 */
export async function findWorkingSiteNumber(startNumber, range = DEFAULT_RANGE) {
  let fetchErrors = 0;
  let attempts = 0;

  for (let offset = 0; offset <= range; offset += 1) {
    const candidate = startNumber + offset;
    attempts += 1;

    try {
      const reachable = await isSiteReachable(candidate);
      if (reachable) {
        return { found: candidate, blocked: false };
      }
    } catch {
      fetchErrors += 1;
    }
  }

  if (fetchErrors >= attempts) {
    return { found: null, blocked: true };
  }

  return { found: null, blocked: false };
}
