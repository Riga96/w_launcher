/**
 * ui.js — DOM rendering, dialogs, toasts, and form state.
 *
 * Compact one-row bookmark list: badge, title, episode, open button, icon actions.
 * Favorites sort first, then by updatedAt descending.
 */

import { buildOpenUrl, buildPathForEpisode, getBookmarkPath } from './parser.js';

/** @type {number} */
let toastCounter = 0;

/** Tracks render state per card to skip unchanged DOM updates. */
const cardRenderState = new Map();

/**
 * Escape HTML special characters for safe insertion.
 * @param {string} value
 * @returns {string}
 */
export function esc(value) {
  return String(value || '').replace(/[&<>"]/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
  );
}

/**
 * Show a temporary toast notification.
 * @param {string} message
 * @param {'ok' | 'info'} [type='ok']
 */
export function toast(message, type = 'ok') {
  toastCounter += 1;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'ok' ? '✓' : 'ℹ'}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(message)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/**
 * Read the current search query from the input.
 * @returns {string}
 */
export function getSearchQuery() {
  return document.getElementById('search').value.toLowerCase();
}

/**
 * Generate a stable badge color from workId.
 * @param {string} workId
 * @returns {string}
 */
export function badgeColorFromWorkId(workId) {
  let hash = 0;
  const str = String(workId);
  for (let i = 0; i < str.length; i += 1) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [210, 240, 280, 320, 350, 25, 45, 160, 190, 130];
  const hue = hues[Math.abs(hash) % hues.length];
  return `hsl(${hue}, 52%, 40%)`;
}

/**
 * Badge label from title or workId.
 * @param {object} bookmark
 * @returns {string}
 */
export function badgeLabel(bookmark) {
  const title = (bookmark.title || '').trim();
  if (title) return title.charAt(0);
  const id = String(bookmark.workId || '');
  return id.slice(-2) || '?';
}

/**
 * Filter and sort bookmarks: favorites first, then updatedAt desc.
 * @param {Array} bookmarks
 * @param {string} query
 * @returns {Array}
 */
export function filterBookmarks(bookmarks, query) {
  return bookmarks
    .filter((b) =>
      (b.title + b.memo + b.workId + b.episodeId + b.category + (b.path || ''))
        .toLowerCase()
        .includes(query)
    )
    .sort((a, b) => {
      const favDiff = Number(b.favorite) - Number(a.favorite);
      if (favDiff !== 0) return favDiff;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

/**
 * Build compact row HTML for a bookmark.
 * @param {object} bookmark
 * @param {number | null} siteNumber
 * @returns {string}
 */
export function buildCardHtml(bookmark, _expandedHistory, siteNumber) {
  const id = esc(bookmark.id);
  const color = bookmark.badgeColor || badgeColorFromWorkId(bookmark.workId);
  const label = esc(badgeLabel(bookmark));
  const favClass = bookmark.favorite ? 'bm-icon active' : 'bm-icon';
  const favIcon = bookmark.favorite ? '★' : '☆';

  return `
  <div class="bm-badge" style="background:${esc(color)}" aria-hidden="true">${label}</div>
  <div class="bm-info">
    <div class="bm-title">${esc(bookmark.title)}</div>
    <div class="bm-ep">${esc(bookmark.episodeId)}화</div>
  </div>
  <button class="bm-open" onclick="handleLaunch('current','${id}')" title="열기">열기</button>
  <button class="bm-site-plus" onclick="handleLaunchSitePlus('${id}')" title="사이트 번호 +1 후 열기">+번호</button>
  <div class="bm-icons">
    <button class="${favClass}" onclick="handleToggleFavorite('${id}')" title="즐겨찾기">${favIcon}</button>
    <button class="bm-icon" onclick="handleEdit('${id}')" title="수정">✏</button>
    <button class="bm-icon del" onclick="handleDelete('${id}')" title="삭제">🗑</button>
  </div>`;
}

/**
 * Compute a cache key for detecting whether a row needs re-rendering.
 * @param {object} bookmark
 * @param {number | null} siteNumber
 * @returns {string}
 */
function cardStateKey(bookmark, siteNumber) {
  return `${bookmark.updatedAt}|${bookmark.favorite}|${bookmark.title}|${bookmark.episodeId}|${bookmark.path}|${siteNumber}`;
}

/**
 * Create or update a compact bookmark row.
 * @param {object} bookmark
 * @param {Set<string>} expandedHistory
 * @param {number | null} siteNumber
 * @returns {HTMLElement}
 */
function createOrUpdateCard(bookmark, expandedHistory, siteNumber) {
  const cardId = `bm-${bookmark.id}`;
  const stateKey = cardStateKey(bookmark, siteNumber);
  let card = document.getElementById(cardId);

  if (!card) {
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'bm-row';
    card.innerHTML = buildCardHtml(bookmark, expandedHistory, siteNumber);
    cardRenderState.set(bookmark.id, stateKey);
    return card;
  }

  if (cardRenderState.get(bookmark.id) !== stateKey) {
    card.innerHTML = buildCardHtml(bookmark, expandedHistory, siteNumber);
    cardRenderState.set(bookmark.id, stateKey);
  }

  return card;
}

/**
 * Build the empty-state HTML for the bookmark list.
 * @param {boolean} hasAnyBookmarks
 * @returns {string}
 */
function buildEmptyHtml(hasAnyBookmarks) {
  return `<div class="empty"><div class="empty-icon">📚</div>${hasAnyBookmarks ? '검색 결과가 없습니다.' : '아직 저장된 작품이 없어요.<br>위에서 추가해보세요!'}</div>`;
}

/**
 * Render the bookmark list with incremental row updates.
 * @param {Array} bookmarks
 * @param {Set<string>} expandedHistory
 * @param {number | null} siteNumber
 */
export function renderList(bookmarks, expandedHistory, siteNumber) {
  const query = getSearchQuery();
  const filtered = filterBookmarks(bookmarks, query);
  const list = document.getElementById('list');

  if (!filtered.length) {
    list.innerHTML = buildEmptyHtml(bookmarks.length > 0);
    cardRenderState.clear();
    return;
  }

  const filteredIds = new Set(filtered.map((b) => b.id));
  const cards = filtered.map((b) => createOrUpdateCard(b, expandedHistory, siteNumber));

  list.querySelectorAll('.bm-row').forEach((node) => {
    const id = node.id.replace(/^bm-/, '');
    if (!filteredIds.has(id)) {
      node.remove();
      cardRenderState.delete(id);
    }
  });

  if (list.querySelector('.empty')) {
    list.innerHTML = '';
  }

  cards.forEach((card, index) => {
    const current = list.children[index];
    if (current !== card) {
      list.insertBefore(card, current || null);
    }
  });

  while (list.children.length > cards.length) {
    list.lastElementChild.remove();
  }
}

/**
 * Set auto-find button loading state.
 * @param {boolean} loading
 */
export function setAutoFindLoading(loading) {
  const btn = document.getElementById('autoFindBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '🔍 찾는 중…' : '🌐 사이트 번호 자동 찾기';
}

/* ── Form helpers ── */

const FORM_FIELD_IDS = [
  'urlInput',
  'fTitle',
  'fCategory',
  'fDomain',
  'fWorkId',
  'fEpisodeId',
  'fMemo',
];

const FORM_ADD_TITLE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> 새 작품 추가';

const FORM_EDIT_TITLE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent)"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 작품 수정';

export function fillForm(parsed) {
  document.getElementById('fCategory').value = parsed.category || '';
  document.getElementById('fWorkId').value = parsed.workId || '';
  document.getElementById('fEpisodeId').value = parsed.episodeId || '';
  document.getElementById('fDomain').value = parsed.domain || '';
  if (parsed.url) document.getElementById('urlInput').value = parsed.url;
}

export function resetFormUi() {
  FORM_FIELD_IDS.forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('formTitle').innerHTML = FORM_ADD_TITLE;
  document.getElementById('saveBtn').textContent = '저장';
}

export function populateEditForm(bookmark, url) {
  document.getElementById('urlInput').value = url;
  document.getElementById('fTitle').value = bookmark.title;
  document.getElementById('fCategory').value = bookmark.category;
  document.getElementById('fDomain').value = bookmark.domain;
  document.getElementById('fWorkId').value = bookmark.workId;
  document.getElementById('fEpisodeId').value = bookmark.episodeId;
  document.getElementById('fMemo').value = bookmark.memo || '';
  document.getElementById('formTitle').innerHTML = FORM_EDIT_TITLE;
  document.getElementById('saveBtn').textContent = '수정 완료';
}

export function readFormValues() {
  return {
    title: document.getElementById('fTitle').value.trim(),
    domain: document.getElementById('fDomain').value.trim(),
    category: document.getElementById('fCategory').value.trim(),
    workId: document.getElementById('fWorkId').value.trim(),
    episodeId: document.getElementById('fEpisodeId').value.trim(),
    memo: document.getElementById('fMemo').value.trim(),
  };
}

export function scrollToForm() {
  document.getElementById('formCard').scrollIntoView({ behavior: 'smooth' });
}

export function setShortcutUrlText(text) {
  document.getElementById('shortcutUrl').textContent = text;
}

export function setShortcutPanelOpen(isOpen) {
  document.getElementById('shortcutContent').classList.toggle('open', isOpen);
  document.getElementById('shortcutArrow').textContent = isOpen ? '▲' : '▼';
}

export function copyToClipboard(text) {
  navigator.clipboard?.writeText(text)
    .then(() => toast('URL 복사됨'))
    .catch(() => toast('클립보드 복사 실패', 'info'));
}

export function clearShareUrlInput() {
  document.getElementById('shareUrl').value = '';
}

export function syncSiteNumberInput(siteNumber) {
  const input = document.getElementById('siteNumber');
  if (input) input.value = siteNumber != null ? String(siteNumber) : '';
}

export function readSiteNumberInput() {
  const raw = document.getElementById('siteNumber')?.value.trim();
  if (!raw) return null;
  const num = parseInt(raw, 10);
  return isNaN(num) ? null : num;
}

export function clearBulkDomainInput() {
  document.getElementById('bulkDomain').value = '';
}

/** Build history open URL using current site number. Used by launcher when recording visits. */
export { buildOpenUrl, buildPathForEpisode, getBookmarkPath };
