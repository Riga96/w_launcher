/**
 * app.js — Saved-episode launcher entry point.
 *
 * Opens bookmarks via http://blacktoon{currentSiteNumber}.com + saved path.
 * Episode IDs are never incremented — only the saved path is opened.
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
  defaultWorkTitle,
  isValidNickname,
} from './parser.js?v=2.0.9';
import {
  loadBookmarks,
  saveBookmarks,
  createBookmark,
  applyBulkDomain,
  mergeImportedBookmarks,
  exportBookmarksJson,
  parseImportJson,
  initSettings,
  setCurrentSiteNumber,
} from './storage.js?v=2.0.9';
import { openSaved, openInNewTab } from './launcher.js?v=2.0.9';
import { findWorkingSiteNumber } from './site-finder.js?v=2.0.9';
import { APP_VERSION, APP_VERSION_LABEL } from './version.js?v=2.0.9';
import { checkForUpdate, applyUpdate, showUpdateBanner } from './updater.js?v=2.0.9';
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
  clearPasteUrlInput,
  clearBulkDomainInput,
  syncSiteNumberInput,
  readSiteNumberInput,
  setAutoFindLoading,
  setAdvancedPanelOpen,
  focusDisplayEpisodeField,
  normalizeDisplayEpisode,
  clearRenderCache,
  focusPasteInput,
  setPasteImportActive,
} from './ui.js?v=2.0.9';

/** @type {Array} In-memory bookmark store */
let data = [];

/** @type {number | null} Current blacktoon site number */
let currentSiteNumber = null;

/** @type {string | null} Id of bookmark currently being edited */
let editingId = null;

/** @type {boolean} Whether the shortcut guide panel is open */
let shortcutOpen = false;

/** @type {boolean} Whether the advanced manual section is open */
let advancedOpen = false;

/* ── Render bridge ── */

function render() {
  renderList(data, currentSiteNumber);
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
 * title, nickname, and displayEpisode are never modified — preserved on re-import.
 * @param {object} bookmark
 * @param {object} parsed
 * @param {string} rawUrl
 */
function applyParsedToBookmark(bookmark, parsed, rawUrl) {
  const now = new Date().toISOString();

  bookmark.workId = parsed.workId;
  bookmark.episodeId = parsed.episodeId;
  bookmark.category = parsed.category;
  bookmark.path = parsed.path;
  bookmark.lastUrl = rawUrl;
  bookmark.domain = parsed.host || bookmark.domain;
  bookmark.updatedAt = now;
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
 * Create and store a new bookmark from parsed URL data.
 * @param {object} parsed
 * @param {string} [rawUrl]
 * @returns {object}
 */
function createNewBookmarkFromParsed(parsed, rawUrl) {
  applySiteNumberFromParsed(parsed);

  const now = new Date().toISOString();

  const bookmark = createBookmark({
    title: defaultWorkTitle(parsed.workId),
    nickname: '',
    displayEpisode: '',
    favorite: false,
    domain: parsed.host || parsed.domain || '',
    category: parsed.category,
    workId: parsed.workId,
    episodeId: parsed.episodeId,
    path: parsed.path,
    lastUrl: rawUrl || parsed.lastUrl,
    updatedAt: now,
    history: [],
  });

  data.unshift(bookmark);
  return bookmark;
}

/**
 * Import a webtoon URL (clipboard, paste input, shortcuts).
 * @param {string} rawUrl
 * @returns {{ status: 'empty' | 'invalid' | 'already' | 'success', title?: string, isNew?: boolean }}
 */
function importWebtoonUrl(rawUrl) {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return { status: 'empty' };

  const parsed = parseClipboardWebtoonUrl(trimmed) || parseWebtoonUrl(trimmed);
  if (!parsed) return { status: 'invalid' };

  applySiteNumberFromParsed(parsed);
  const existing = findBookmarkByWork(data, parsed);

  if (existing) {
    const samePath = existing.path === parsed.path;
    applyParsedToBookmark(existing, parsed, trimmed);
    persistAndRender();
    return { status: samePath ? 'already' : 'success', title: existing.title };
  }

  const bookmark = createNewBookmarkFromParsed(parsed, trimmed);
  persistAndRender();
  return { status: 'success', title: bookmark.title, isNew: true };
}

/**
 * Show toast feedback for import result.
 * @param {{ status: string, title?: string, isNew?: boolean }} result
 */
function showImportResult(result) {
  if (result.status === 'empty') {
    toast('복사된 웹툰 링크가 없어요.', 'info');
    return;
  }
  if (result.status === 'invalid') {
    toast('웹툰 링크가 아니에요.', 'info');
    return;
  }
  if (result.status === 'already') {
    toast('이미 저장된 회차예요.');
    return;
  }
  if (result.isNew) {
    toast(`"${result.title}" 저장됨`);
    return;
  }
  toast(`"${result.title}" 회차 저장됨`);
}

/**
 * Parse a URL and fill form fields (same logic as the 분석 button).
 * @param {string} raw
 * @param {{ preserveTitle?: boolean }} [options]
 * @returns {object | null}
 */
function parseUrlIntoForm(raw, options = {}) {
  const trimmed = (raw || '').trim();
  const parsed = parseWebtoonUrl(trimmed);
  if (!parsed) return null;

  document.getElementById('urlInput').value = trimmed;
  document.getElementById('fDomain').value = parsed.host;
  document.getElementById('fCategory').value = parsed.category;
  document.getElementById('fWorkId').value = parsed.workId;
  document.getElementById('fEpisodeId').value = parsed.episodeId;

  if (!options.preserveTitle) {
    document.getElementById('fTitle').value = defaultWorkTitle(parsed.workId);
    document.getElementById('fNickname').value = '';
  }

  applySiteNumberFromParsed(parsed);
  return parsed;
}

/**
 * Save from the main paste input.
 */
function handlePasteSave() {
  const raw = document.getElementById('pasteUrl')?.value ?? '';
  const result = importWebtoonUrl(raw);
  showImportResult(result);
  if (result.status === 'success' || result.status === 'already') {
    clearPasteUrlInput();
  }
}

/** Whether the next paste into pasteUrl should auto-save. */
let pasteImportArmed = false;

/** Prefetched clipboard read started on pointerdown (iOS user-gesture). */
let clipboardPrefetch = null;

/**
 * Save a URL string and show feedback.
 * @param {string} raw
 * @returns {{ status: string, title?: string, isNew?: boolean }}
 */
function saveFromUrlText(raw) {
  const result = importWebtoonUrl(raw);
  showImportResult(result);
  return result;
}

/**
 * Read clipboard text — tries multiple APIs (iOS PWA often blocks readText).
 * @returns {Promise<string>}
 */
async function readClipboardText() {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) return text;
    }
  } catch {
    /* blocked in standalone PWA */
  }

  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of ['text/plain', 'text/uri-list']) {
          if (!item.types.includes(type)) continue;
          const blob = await item.getType(type);
          const text = await blob.text();
          const line = text.split('\n').find((row) => row.trim().startsWith('http'));
          if (line?.trim()) return line.trim();
        }
      }
    }
  } catch {
    /* blocked */
  }

  return '';
}

/**
 * Arm pasteUrl so the next paste auto-saves (iPhone fallback).
 */
function armPasteImport() {
  pasteImportArmed = true;
  setPasteImportActive(true);
  focusPasteInput();
  toast('붙여넣기를 한 번 눌러주세요', 'info');
}

/**
 * Disarm auto-paste import mode.
 */
function disarmPasteImport() {
  pasteImportArmed = false;
  setPasteImportActive(false);
}

/**
 * Try saving from clipboard; on iPhone PWA fall back to one-tap paste.
 */
async function handleClipboardImport() {
  disarmPasteImport();

  let text = '';
  if (clipboardPrefetch) {
    text = (await clipboardPrefetch).trim();
    clipboardPrefetch = null;
  }
  if (!text) {
    text = (await readClipboardText()).trim();
  }

  if (text) {
    saveFromUrlText(text);
    return;
  }

  armPasteImport();
}

/**
 * Wire pasteUrl listeners and 웹툰 추가 button for iOS clipboard limits.
 */
function setupWebtoonImportUi() {
  const btn = document.querySelector('.clipboard-import-btn');
  const input = document.getElementById('pasteUrl');
  if (!input) return;

  if (btn) {
    btn.addEventListener('pointerdown', () => {
      clipboardPrefetch = readClipboardText();
    }, { passive: true });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleClipboardImport();
    });
  }

  input.addEventListener('paste', (e) => {
    if (!pasteImportArmed) return;

    const clip = e.clipboardData?.getData('text/plain')?.trim();
    if (clip) {
      e.preventDefault();
      input.value = clip;
    }

    window.setTimeout(() => {
      if (!pasteImportArmed) return;
      const raw = input.value.trim();
      if (!raw) return;

      const result = saveFromUrlText(raw);
      if (result.status !== 'invalid' && result.status !== 'empty') {
        clearPasteUrlInput();
        disarmPasteImport();
        input.blur();
      }
    }, 0);
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (pasteImportArmed && !input.value.trim()) {
        disarmPasteImport();
      }
    }, 200);
  });
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
  const parsed = parseUrlIntoForm(document.getElementById('urlInput').value, {
    preserveTitle: !!editingId,
  });
  if (!parsed) {
    alert('URL 형식을 확인해주세요.');
  }
}

/**
 * Save or update a bookmark from the form.
 */
function handleSave() {
  const {
    title,
    nickname,
    displayEpisode,
    domain: rawDomain,
    category,
    workId,
    episodeId,
    memo,
  } = readFormValues();
  const domain = normDomain(rawDomain);

  if (!domain || !category || !workId || !episodeId) {
    alert('도메인, 카테고리, 작품ID, 회차ID를 입력해주세요.');
    return;
  }

  if (!isValidNickname(nickname)) {
    alert('약칭은 2~4글자로 입력해주세요.');
    return;
  }

  const resolvedTitle = title || defaultWorkTitle(workId);
  const resolvedDisplayEpisode = normalizeDisplayEpisode(displayEpisode, episodeId);

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
        title: resolvedTitle,
        nickname,
        displayEpisode: resolvedDisplayEpisode,
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
        title: resolvedTitle,
        nickname,
        displayEpisode: resolvedDisplayEpisode,
        domain,
        category,
        workId,
        episodeId,
        path,
        memo,
        lastUrl: openUrl,
        updatedAt: now,
        history: [],
      })
    );
    toast(`"${resolvedTitle}" 저장됨`);
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
  if (!advancedOpen) {
    advancedOpen = true;
    setAdvancedPanelOpen(true);
  }
  populateEditForm(
    bookmark,
    currentSiteNumber != null
      ? buildBookmarkOpenUrl(bookmark, currentSiteNumber)
      : bookmark.lastUrl || `http://${bookmark.domain}${bookmark.path}`
  );
  scrollToForm();
}

/**
 * Quick-edit displayEpisode from the list row.
 * @param {string} id
 */
function handleQuickEditEpisode(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark) return;

  const current = bookmark.displayEpisode || '';
  const next = prompt('실제 회차를 입력하세요 (예: 82화)', current);
  if (next === null) return;

  bookmark.displayEpisode = normalizeDisplayEpisode(next.trim(), bookmark.episodeId);
  bookmark.updatedAt = new Date().toISOString();
  persistAndRender();
  toast('회차 저장됨');
}

/**
 * Open edit form focused on displayEpisode.
 * @param {string} id
 */
function handleEditEpisode(id) {
  handleEdit(id);
  focusDisplayEpisodeField();
}

/**
 * Delete a bookmark after confirmation.
 * @param {string} id
 */
function handleDelete(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark || !confirm(`"${bookmark.title}"을 삭제할까요?`)) return;
  data = data.filter((x) => x.id !== id);
  persistAndRender();
}

/**
 * Open the saved episode path for a bookmark.
 * @param {string} id
 */
function handleOpenSaved(id) {
  const bookmark = data.find((x) => x.id === id);
  if (!bookmark || !requireSiteNumber()) return;

  const result = openSaved(bookmark, currentSiteNumber);
  if (!result) return;

  openInNewTab(result.url);
  toast(`"${bookmark.title}" — ${result.label}`);
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
 * Toggle the advanced manual section.
 */
function toggleAdvanced() {
  advancedOpen = !advancedOpen;
  setAdvancedPanelOpen(advancedOpen);
}

/**
 * Copy the shortcut URL template to clipboard.
 */
function copyShortcutUrl() {
  copyToClipboard(`${location.origin}${location.pathname}?url=`);
}

/**
 * Extract a webtoon URL from launch query params (Shortcuts / Share Target).
 * @param {URLSearchParams} params
 * @returns {string | null}
 */
function extractLaunchUrl(params) {
  const direct = params.get('url');
  if (direct?.trim()) return direct.trim();

  const text = params.get('text') || params.get('title') || '';
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

/**
 * Handle ?url= query param from iPhone Shortcuts / Share Target.
 */
function handleUrlParam() {
  const params = new URLSearchParams(location.search);
  const raw = extractLaunchUrl(params);
  if (!raw) {
    handleClipboardImport();
    return;
}
  history.replaceState({}, '', location.pathname);
  const decoded = decodeURIComponent(raw);
  saveFromUrlText(decoded);
}

/* ── Expose handlers for inline onclick attributes ── */

const publicApi = {
  handleClipboardImport,
  handlePasteSave,
  handleSaveSiteNumber,
  handleAutoFindSiteNumber,
  handleParseUrl,
  handleSave,
  resetForm,
  handleEdit,
  handleEditEpisode,
  handleQuickEditEpisode,
  handleDelete,
  handleOpenSaved,
  handleToggleFavorite,
  handleBulkDomain,
  handleBackup,
  handleRestore,
  handleClearAll,
  toggleShortcut,
  toggleAdvanced,
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
  clearRenderCache();
  setupWebtoonImportUi();
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
