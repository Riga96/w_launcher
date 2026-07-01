/**
 * updater.js — Remote version check and safe PWA refresh.
 *
 * Never touches localStorage. Only clears Cache API and service worker registrations.
 */

/**
 * Normalize version strings for comparison (strips leading "v").
 * @param {string} value
 * @returns {string}
 */
export function normalizeVersion(value) {
  return String(value || '').replace(/^v/i, '').trim();
}

/**
 * Fetch remote version.json with cache-busting.
 * @returns {Promise<{ version: string, updatedAt?: string } | null>}
 */
async function fetchRemoteVersion() {
  const response = await fetch(`version.json?v=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data?.version) return null;
  return data;
}

/**
 * Compare remote version.json with the bundled app version.
 * Fails silently on network or parse errors.
 * @param {string} currentVersion
 * @returns {Promise<string | null>} remote version if newer/different, else null
 */
export async function checkForUpdate(currentVersion) {
  try {
    const remote = await fetchRemoteVersion();
    if (!remote) return null;

    const local = normalizeVersion(currentVersion);
    const remoteNorm = normalizeVersion(remote.version);

    if (remoteNorm && remoteNorm !== local) {
      return remote.version;
    }
  } catch {
    /* silent fallback — app continues normally */
  }
  return null;
}

/**
 * Show the update banner when a newer version is available.
 */
export function showUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.hidden = false;
}

/**
 * Hide the update banner.
 */
export function hideUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.hidden = true;
}

/**
 * Clear caches, unregister service workers, and reload with cache-busting.
 * Does NOT clear localStorage.
 */
export async function applyUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch {
    /* proceed with reload even if cleanup partially fails */
  }

  const basePath = location.pathname.split('?')[0];
  location.href = `${basePath}?v=${Date.now()}`;
}
