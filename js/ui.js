/**
 * ui.js — DOM rendering for the saved-episode launcher.
 *
 * Compact one-row list: badge, title, displayEpisode, open button, icon actions.
 */

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
  const nick = (bookmark.nickname || '').trim();
  if (nick) return nick.slice(0, 4);
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
      (b.title + b.nickname + b.memo + b.workId + b.episodeId + b.displayEpisode + b.category + (b.path || ''))
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
 * Detect labels that look like internal URL episode IDs, not user-facing names.
 * @param {string} label
 * @param {string} episodeId
 * @returns {boolean}
 */
function isInternalEpisodeLabel(label, episodeId) {
  const trimmed = String(label || '').trim();
  if (!trimmed) return true;

  const id = String(episodeId || '').trim();
  if (id && (trimmed === id || trimmed === `${id}화`)) return true;

  // 6+ digit numbers with optional "화" are almost always URL episode IDs.
  if (/^\d{6,}화?$/.test(trimmed)) return true;

  return false;
}

/**
 * User-facing episode label, or placeholder when unset.
 * Never falls back to internal episodeId.
 * @param {object} bookmark
 * @returns {string}
 */
export function episodeDisplayLabel(bookmark) {
  const raw = bookmark?.displayEpisode;
  if (raw == null) return '회차 미입력';

  const label = String(raw).trim();
  if (!label) return '회차 미입력';

  if (isInternalEpisodeLabel(label, bookmark.episodeId)) {
    return '회차 미입력';
  }

  return label;
}

/**
 * Normalize displayEpisode before saving to localStorage.
 * @param {string} value
 * @param {string} episodeId
 * @returns {string}
 */
export function normalizeDisplayEpisode(value, episodeId) {
  const trimmed = String(value || '').trim();
  if (isInternalEpisodeLabel(trimmed, episodeId)) return '';
  return trimmed;
}

/**
 * Short date for list subtitle.
 * @param {string} iso
 * @returns {string}
 */
export function formatUpdatedAtShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/**
 * Build compact row HTML for a bookmark.
 * @param {object} bookmark
 * @param {number | null} siteNumber
 * @returns {string}
 */
export function buildCardHtml(bookmark, siteNumber) {
  const id = esc(bookmark.id);
  const color = bookmark.badgeColor || badgeColorFromWorkId(bookmark.workId);
  const label = esc(badgeLabel(bookmark));
  const favClass = bookmark.favorite ? 'bm-icon active' : 'bm-icon';
  const favIcon = bookmark.favorite ? '★' : '☆';
  const episodeText = esc(episodeDisplayLabel(bookmark));
  const hasDisplayEpisode = episodeDisplayLabel(bookmark) !== '회차 미입력';
  const episodeClass = hasDisplayEpisode ? 'bm-ep bm-ep-tap' : 'bm-ep bm-ep-tap bm-ep-empty';

  return `
  <div class="bm-badge" style="background:${esc(color)}" aria-hidden="true">${label}</div>
  <div class="bm-info">
    <div class="bm-title">${esc(bookmark.title)}</div>
    <button type="button" class="${episodeClass}" onclick="handleQuickEditEpisode('${id}')" title="탭하여 회차 수정">${episodeText}</button>
  </div>
  <button class="bm-open" onclick="handleOpenSaved('${id}')" title="저장된 화 열기">저장된 화 열기</button>
  <button type="button" class="bm-ep-edit" onclick="handleQuickEditEpisode('${id}')" title="실제 회차 수정">회차 수정</button>
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
  return `${bookmark.updatedAt}|${bookmark.favorite}|${bookmark.title}|${bookmark.nickname}|${episodeDisplayLabel(bookmark)}|${bookmark.path}|${siteNumber}`;
}

/**
 * Create or update a compact bookmark row.
 * @param {object} bookmark
 * @param {Set<string>} expandedHistory
 * @param {number | null} siteNumber
 * @returns {HTMLElement}
 */
function createOrUpdateCard(bookmark, siteNumber) {
  const cardId = `bm-${bookmark.id}`;
  const stateKey = cardStateKey(bookmark, siteNumber);
  let card = document.getElementById(cardId);

  if (!card) {
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'bm-row';
    card.innerHTML = buildCardHtml(bookmark, siteNumber);
    cardRenderState.set(bookmark.id, stateKey);
    return card;
  }

  if (cardRenderState.get(bookmark.id) !== stateKey) {
    card.innerHTML = buildCardHtml(bookmark, siteNumber);
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
export function renderList(bookmarks, siteNumber) {
  const query = getSearchQuery();
  const filtered = filterBookmarks(bookmarks, query);
  const list = document.getElementById('list');

  if (!filtered.length) {
    list.innerHTML = buildEmptyHtml(bookmarks.length > 0);
    cardRenderState.clear();
    return;
  }

  const filteredIds = new Set(filtered.map((b) => b.id));
  const cards = filtered.map((b) => createOrUpdateCard(b, siteNumber));

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
 * Clear cached row DOM so the next render uses the latest template.
 */
export function clearRenderCache() {
  cardRenderState.clear();
  document.getElementById('list')?.querySelectorAll('.bm-row').forEach((node) => node.remove());
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
  'fNickname',
  'fDisplayEpisode',
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
  document.getElementById('fDomain').value = parsed.domain || parsed.host || '';
  document.getElementById('fTitle').value = parsed.workId ? `webtoons-${parsed.workId}` : '';
  document.getElementById('fNickname').value = '';
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
  document.getElementById('fNickname').value = bookmark.nickname || '';
  document.getElementById('fDisplayEpisode').value = bookmark.displayEpisode || '';
  document.getElementById('fCategory').value = bookmark.category;
  document.getElementById('fDomain').value = bookmark.domain;
  document.getElementById('fWorkId').value = bookmark.workId;
  document.getElementById('fEpisodeId').value = bookmark.episodeId;
  document.getElementById('fMemo').value = bookmark.memo || '';
  document.getElementById('formTitle').innerHTML = FORM_EDIT_TITLE;
  document.getElementById('saveBtn').textContent = '수정 완료';
}

export function focusDisplayEpisodeField() {
  const input = document.getElementById('fDisplayEpisode');
  if (!input) return;
  input.focus();
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function readFormValues() {
  return {
    title: document.getElementById('fTitle').value.trim(),
    nickname: document.getElementById('fNickname').value.trim(),
    displayEpisode: document.getElementById('fDisplayEpisode').value.trim(),
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

export function clearPasteUrlInput() {
  const input = document.getElementById('pasteUrl');
  if (input) input.value = '';
}

export function setPasteImportActive(active) {
  document.querySelector('.paste-import')?.classList.toggle('paste-import-active', active);
}

export function focusPasteInput() {
  const input = document.getElementById('pasteUrl');
  if (!input) return;
  input.focus();
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function setAdvancedPanelOpen(isOpen) {
  document.getElementById('advancedContent')?.classList.toggle('open', isOpen);
  const arrow = document.getElementById('advancedArrow');
  if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
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
