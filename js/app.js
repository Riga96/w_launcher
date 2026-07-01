/**
 * app.js — Application entry point and module wiring.
 *
 * Opens bookmarks via http://blacktoon{currentSiteNumber}.com + saved path.
 * The site number is global; episode paths stay fixed unless user navigates prev/next.
 */

import {
  buildBookmarkOpenUrl,
  buildPath,
  buildOpenUrl,
  parseWebtoonUrl,
  parseClipboardWebtoonUrl,
  normDomain,
  extractSiteNumber,
  findBookmarkByWork,
} from './parser.js';
import {
  loadBookmarks,
  saveBookmarks,
  upsertHistory,
  createBookmark,
  applyBulkDomain,
  mergeImportedBookmarks,
  exportBookmarksJson,
  parseImportJson,
  initSettings,
  setCurrentSiteNumber,
} from './storage.js';
import { openCurrent, openAdjacent, openInNewTab } from './launcher.js';
import { findWorkingSiteNumber } from './site-finder.js';
import { APP_VERSION, APP_VERSION_LABEL } from './version.js';
import { checkForUpdate, applyUpdate, showUpdateBanner } from './updater.js';
import {
  toast,
  renderList,
  fillForm,
  resetFormUi,
  populateEditForm,
  readFormValues,
  scrollToForm,
  setShortcutUrlText,
  setShortcutPanelOpen,
  copyToClipboard,
  clearShareUrlInput,
  clearBulkDomainInput,
  syncSiteNumberInput,
  readSiteNumberInput,
  setAutoFindLoading,
} from './ui.js';

/** @type {Array} In-memory bookmark store */
let data = [];

/** @type {number | null} Current blacktoon site number */
let currentSiteNumber = null;

/** @type {string | null} Id of bookmark currently being edited */
let editingId = null;

/** @type {Set<string>} Bookmark ids with expanded history panels */
const expandedHistory = new Set();

/** @type {boolean} Whether the shortcut guide panel is open */
let shortcutOpen = false;

/* ── Render bridge ── */

function render() {
  renderList(data, expandedHistory, currentSiteNumber);
}

function persistAndRender() {
  saveBookmarks(data);
  render();
}

function requireSiteNumber() {
  if (currentSiteNumber == null) {
    toast('현재 사이트 번호를 먼저 설정해주세요.', 'info');
    return false;
  }
  return true;
}

function applySiteNumberFromParsed(parsed) {
  if (parsed.siteNumber != null) {
    currentSiteNumber = parsed.siteNumber;
    setCurrentSiteNumber(parsed.siteNumber);
    syncSiteNumberInput(parsed.siteNumber);
  }
}

/**
 * Apply parsed URL fields to a bookmark record.
 * @param {object} bookmark
 * @param {object} parsed
 * @param {string} rawUrl
 */
function applyParsedToBookmark(bookmark, parsed, rawUrl) {
  const now = new Date().toISOString();
  const openUrl = parsed.siteNumber != null
    ? buildOpenUrl(parsed.siteNumber, parsed.path)
    : rawUrl;

  bookmark.workId = parsed.workId;
  bookmark.episodeId = parsed.episodeId;
  bookmark.category = parsed.category;
  bookmark.path = parsed.path;
  bookmark.lastUrl = rawUrl;
  bookmark.domain = parsed.host || bookmark.domain;
  bookmark.updatedAt = now;
  bookmark.history = upsertHistory(bookmark.history, {
    episodeId: parsed.episodeId,
    url: openUrl,
    viewedAt: now,
  });
}

/**
 * Update an existing bookmark from parsed URL data.
 * @param {object} existing
 * @param {object} parsed
 * @param {string} [rawUrl]
 */
function updateBookmarkFromParsed(existing, parsed, rawUrl) {
  applySiteNumberFromParsed(parsed);
  applyParsedToBookmark(existing, parsed, rawUrl || parsed.lastUrl);
}

/**
 * Handle pasted share URL save (top input).
 */
function handleShareSave() {
  const raw = document.getElementById('shareUrl').value.trim();
  const parsed = parseWebtoonUrl(raw);
  if (!parsed) {
    alert('URL 형식을 확인해주세요.');
    return;
  }

  const existing = findBookmarkByWork(data, parsed);
  if (existing) {
    updateBookmarkFromParsed(existing, parsed, raw);
    persistAndRender();
    toast(`"${existing.title}" 회차 ${parsed.episodeId}로 업데이트됨`);
  } else {
    fillForm({ ...parsed, url: raw });
    applySiteNumberFromParsed(parsed);
    toast('새 작품 — 작품명을 입력하고 저장해주세요.', 'info');
    scrollToForm();
  }
  clearShareUrlInput();
}

/**
 * Save or update a bookmark from clipboard-import parsed data.
 * @param {object} parsed
 * @returns {'success' | 'already'}
 */
function saveFromClipboard(parsed) {
  applySiteNumberFromParsed(parsed);

  const now = new Date().toISOString();
  const openUrl = parsed.siteNumber != null
    ? buildOpenUrl(parsed.siteNumber, parsed.path)
    : parsed.lastUrl;
  const existing = findBookmarkByWork(data, parsed);

  if (existing) {
    const samePath = existing.path === parsed.path;

    applyParsedToBookmark(existing, parsed, parsed.lastUrl);
    persistAndRender();
    return samePath ? 'already' : 'success';
  }

  data.unshift(
    createBookmark({
      title: `webtoons-${parsed.workId}`,
      domain: parsed.host,
      category: 'webtoons',
      workId: parsed.workId,
      episodeId: parsed.episodeId,
      path: parsed.path,
      lastUrl: parsed.lastUrl,
      updatedAt: now,
      history: [{ episodeId: parsed.episodeId, url: openUrl, viewedAt: now }],
    })
  );

  persistAndRender();
  return 'success';
}

/**
 * Read clipboard and import a webtoon URL (user gesture required).
 */
async function handleClipboardImport() {
  let text;

  try {
    if (!navigator.clipboard?.readText) {
      toast('Safari에서는 버튼을 한 번 더 눌러야 할 수 있어요.', 'info');
      return;
    }
    text = await navigator.clipboard.readText();
  } catch {
    toast('Safari에서는 버튼을 한 번 더 눌러야 할 수 있어요.', 'info');
    return;
  }

  const trimmed = (text || '').trim();
  if (!trimmed) {
    toast('복사된 링크가 없어요.', 'info');
    return;
  }

  const parsed = parseClipboardWebtoonUrl(trimmed);
  if (!parsed) {
    toast('웹툰 링크 형식이 아니에요.', 'info');
    return;
  }

  const result = saveFromClipboard(parsed);
  toast(result === 'already' ? '이미 저장된 회차예요.' : '복사한 웹툰을 저장했어요.');
}

/**
 * Save the site number from the settings input.
 */
function handleSaveSiteNumber() {
  const num = readSiteNumberInput();
  if (num == null) {
    toast('사이트 번호를 입력해주세요.', 'info');
    return;
  }
  currentSiteNumber = num;
  setCurrentSiteNumber(num);
  render();
  toast(`사이트 번호 ${num} 저장됨`);
}

/**
 * Auto-detect working blacktoon site number in range start..start+10.
 */
async function handleAutoFindSiteNumber() {
  const start = currentSiteNumber ?? readSiteNumberInput() ?? 415;

  setAutoFindLoading(true);
  try {
    const { found, blocked } = await findWorkingSiteNumber(start);

    if (blocked) {
      toast('자동 확인이 막혔어요. 사이트 번호를 직접 입력해주세요.', 'info');
      return;
    }

    if (found == null) {
      toast('작동하는 사이트 번호를 찾지 못했어요.', 'info');
      return;
    }

    currentSiteNumber = found;
    setCurrentSiteNumber(found);
    syncSiteNumberInput(found);
    render();
    toast(`사이트 번호를 ${found}로 변경했어요.`);
  } finally {
    setAutoFindLoading(false);
  }
}

/**
 * Toggle favorite flag on a bookmark.
 * @param {string} id
 */
function handleToggleFavorite(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark) return;
  bookmark.favorite = !bookmark.favorite;
  persistAndRender();
}

/**
 * Parse URL from the form's URL input into fields.
 */
function handleParseUrl() {
  const parsed = parseWebtoonUrl(document.getElementById('urlInput').value);
  if (!parsed) {
    alert('URL 형식을 확인해주세요.');
    return;
  }
  document.getElementById('fDomain').value = parsed.host;
  document.getElementById('fCategory').value = parsed.category;
  document.getElementById('fWorkId').value = parsed.workId;
  document.getElementById('fEpisodeId').value = parsed.episodeId;
  applySiteNumberFromParsed(parsed);
}

/**
 * Save or update a bookmark from the form.
 */
function handleSave() {
  const { title, domain: rawDomain, category, workId, episodeId, memo } = readFormValues();
  const domain = normDomain(rawDomain);

  if (!title || !domain || !category || !workId || !episodeId) {
    alert('작품명, 도메인, 카테고리, 작품ID, 회차ID를 입력해주세요.');
    return;
  }

  const path = buildPath(category, workId, episodeId);
  const siteFromDomain = extractSiteNumber(domain);
  if (siteFromDomain != null) {
    currentSiteNumber = siteFromDomain;
    setCurrentSiteNumber(siteFromDomain);
    syncSiteNumberInput(siteFromDomain);
  }

  const now = new Date().toISOString();
  const openUrl = currentSiteNumber != null
    ? buildOpenUrl(currentSiteNumber, path)
    : `http://${domain}${path}`;

  if (editingId) {
    const bookmark = data.find((x) => x.id === editingId);
    if (bookmark) {
      Object.assign(bookmark, {
        title,
        domain,
        category,
        workId,
        episodeId,
        path,
        memo,
        updatedAt: now,
      });
    }
    toast('수정 완료');
  } else {
    data.unshift(
      createBookmark({
        title,
        domain,
        category,
        workId,
        episodeId,
        path,
        memo,
        lastUrl: openUrl,
        updatedAt: now,
        history: [{ episodeId, url: openUrl, viewedAt: now }],
      })
    );
    toast(`"${title}" 저장됨`);
  }

  persistAndRender();
  resetForm();
}

/**
 * Reset the form and clear editing state.
 */
function resetForm() {
  editingId = null;
  resetFormUi();
}

/**
 * Enter edit mode for a bookmark.
 * @param {string} id
 */
function handleEdit(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark) return;

  editingId = id;
  populateEditForm(
    bookmark,
    currentSiteNumber != null
      ? buildBookmarkOpenUrl(bookmark, currentSiteNumber)
      : bookmark.lastUrl || `http://${bookmark.domain}${bookmark.path}`
  );
  scrollToForm();
}

/**
 * Delete a bookmark after confirmation.
 * @param {string} id
 */
function handleDelete(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark || !confirm(`"${bookmark.title}"을 삭제할까요?`)) return;
  data = data.filter((x) => x.id !== id);
  expandedHistory.delete(id);
  persistAndRender();
}

/**
 * Launch current, next, or previous episode for a bookmark.
 * @param {'current' | 'next' | 'prev'} action
 * @param {string} id
 */
function handleLaunch(action, id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark || !requireSiteNumber()) return;

  const result = action === 'current'
    ? openCurrent(bookmark, currentSiteNumber)
    : openAdjacent(bookmark, currentSiteNumber, action);

  if (!result) return;

  persistAndRender();
  openInNewTab(result.url);
  toast(`"${bookmark.title}" — ${result.label}`);
}

/**
 * Increment site number and open the bookmark.
 * @param {string} id
 */
function handleLaunchSitePlus(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark || !requireSiteNumber()) return;

  currentSiteNumber += 1;
  setCurrentSiteNumber(currentSiteNumber);
  syncSiteNumberInput(currentSiteNumber);

  const result = openCurrent(bookmark, currentSiteNumber);
  if (!result) return;

  persistAndRender();
  openInNewTab(result.url);
  toast(`+${currentSiteNumber} — "${bookmark.title}" 열기`);
}

/**
 * Apply a new domain to all bookmarks and update site number if blacktoon.
 */
function handleBulkDomain() {
  const domain = normDomain(document.getElementById('bulkDomain').value);
  if (!domain) {
    alert('새 도메인을 입력해주세요.');
    return;
  }
  if (!confirm('모든 저장 항목의 도메인을 바꿀까요?')) return;

  const siteFromDomain = extractSiteNumber(domain);
  if (siteFromDomain != null) {
    currentSiteNumber = siteFromDomain;
    setCurrentSiteNumber(siteFromDomain);
    syncSiteNumberInput(siteFromDomain);
  }

  data = applyBulkDomain(data, domain);
  persistAndRender();
  clearBulkDomainInput();
  toast('도메인 일괄 변경 완료');
}

/**
 * Export bookmarks as JSON download.
 */
function handleBackup() {
  exportBookmarksJson(data);
}

/**
 * Restore bookmarks from a JSON file upload.
 * @param {Event} event
 */
function handleRestore(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = parseImportJson(reader.result);
      const merge = confirm('기존 기록에 합칠까요? 취소를 누르면 덮어씌워집니다.');
      data = mergeImportedBookmarks(data, imported, merge);
      currentSiteNumber = initSettings(data) ?? currentSiteNumber;
      syncSiteNumberInput(currentSiteNumber);
      persistAndRender();
      toast('복원 완료');
    } catch {
      alert('JSON 파일을 확인해주세요.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/**
 * Clear all bookmarks after confirmation.
 */
function handleClearAll() {
  if (!confirm('정말로 모든 북마크를 삭제하시겠습니까?')) return;
  data = [];
  expandedHistory.clear();
  persistAndRender();
  toast('전체 삭제됨', 'info');
}

/**
 * Toggle the iPhone shortcut guide section.
 */
function toggleShortcut() {
  shortcutOpen = !shortcutOpen;
  setShortcutPanelOpen(shortcutOpen);
}

/**
 * Copy the shortcut URL template to clipboard.
 */
function copyShortcutUrl() {
  copyToClipboard(`${location.origin}${location.pathname}?url=`);
}

/**
 * Handle ?url= query param from iPhone Shortcuts.
 */
function handleUrlParam() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('url');
  if (!raw) return;

  history.replaceState({}, '', location.pathname);
  const decoded = decodeURIComponent(raw);
  const parsed = parseWebtoonUrl(decoded);
  if (!parsed) return;

  const existing = findBookmarkByWork(data, parsed);
  if (existing) {
    updateBookmarkFromParsed(existing, parsed, decoded);
    persistAndRender();
    toast(`"${existing.title}" 회차 ${parsed.episodeId}로 자동 업데이트됨`);
  } else {
    fillForm({ ...parsed, url: decoded });
    applySiteNumberFromParsed(parsed);
    toast('URL에서 정보를 불러왔어요. 작품명을 입력하고 저장해주세요.', 'info');
    setTimeout(scrollToForm, 100);
  }
}

/* ── Expose handlers for inline onclick attributes ── */

const publicApi = {
  handleShareSave,
  handleClipboardImport,
  handleSaveSiteNumber,
  handleAutoFindSiteNumber,
  handleParseUrl,
  handleSave,
  resetForm,
  handleEdit,
  handleDelete,
  handleLaunch,
  handleLaunchSitePlus,
  handleToggleFavorite,
  handleBulkDomain,
  handleBackup,
  handleRestore,
  handleClearAll,
  toggleShortcut,
  copyShortcutUrl,
  render,
  handleApplyUpdate: applyUpdate,
};

Object.assign(window, publicApi);

/* ── Initialization ── */

function init() {
  data = loadBookmarks();
  currentSiteNumber = initSettings(data);
  syncSiteNumberInput(currentSiteNumber);
  handleUrlParam();
  render();

  setShortcutUrlText(`${location.origin}${location.pathname}?url=[현재 URL]`);

  const footer = document.querySelector('.app-footer');
  if (footer) footer.textContent = APP_VERSION_LABEL;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(`service-worker.js?v=${APP_VERSION}`, { updateViaCache: 'none' })
      .catch(() => {});
  }

  checkForUpdate(APP_VERSION).then((remoteVersion) => {
    if (remoteVersion) showUpdateBanner();
  });
}

init();
