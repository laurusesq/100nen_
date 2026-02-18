if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW registration failed', e));
}

const API_URL = 'https://raspy-sunset-f70a.100nen-data.workers.dev/api/articles';
const BATCH = 12;
const CACHE_KEY = 'articlesCacheV1';
const CACHE_MAX_AGE_MS = 1000 * 60 * 10;

const state = {
  all: [],
  visible: [],
  page: 0,
  genre: 'すべて',
  selectedTags: new Set(),
  query: '',
  sort: 'dateDesc',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  comments: JSON.parse(localStorage.getItem('commentsByArticle') || '{}'),
  favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
  readSet: new Set(JSON.parse(localStorage.getItem('readSet') || '[]')),
  tagOverrides: JSON.parse(localStorage.getItem('tagOverrides') || '{}'),
  points: Number(localStorage.getItem('points') || 0)
};

const el = {
  searchInput: document.getElementById('searchInput'),
  sortSelect: document.getElementById('sortSelect'),
  genres: document.getElementById('genres'),
  articleList: document.getElementById('articleList'),
  sentinel: document.getElementById('sentinel'),
  emptyState: document.getElementById('emptyState'),
  tagList: document.getElementById('tagList'),
  clearTagsBtn: document.getElementById('clearTagsBtn'),
  favoriteList: document.getElementById('favoriteList'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pointBadge: document.getElementById('pointBadge'),
  loginDialog: document.getElementById('loginDialog'),
  loginForm: document.getElementById('loginForm'),
  usernameInput: document.getElementById('usernameInput'),
  newNotice: document.getElementById('newNotice')
};

init();

async function init() {
  bindEvents();
  hydrateSessionUI();
  setupInfiniteScroll();

  const cached = loadCache();
  if (cached) {
    applyIncomingRows(cached.rows, { source: 'cache' });
    if (!cached.isFresh) {
      fetchAndApplyLatest();
    }
    return;
  }

  await fetchAndApplyLatest();
}

async function fetchAndApplyLatest() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('記事取得に失敗');
    const rows = await res.json();
    saveCache(rows);
    applyIncomingRows(rows, { source: 'network' });
  } catch (error) {
    if (!state.all.length) {
      el.articleList.innerHTML = '<p class="card">記事の読み込みに失敗しました。時間をおいて再試行してください。</p>';
    }
    console.error(error);
  }
}

function applyIncomingRows(rows, { source }) {
  state.all = rows.map((r, i) => normalizeArticle(r, i));
  notifyNewArticles();
  renderGenres();
  renderTagFilters();
  applyFilters(true);

  if (source === 'cache') {
    el.newNotice.textContent = '高速表示のためキャッシュを利用中。最新データを確認しています…';
    el.newNotice.classList.remove('hidden');
  } else if (source === 'network' && el.newNotice.textContent.includes('キャッシュ')) {
    el.newNotice.classList.add('hidden');
    el.newNotice.textContent = '';
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.rows) || !parsed.savedAt) return null;
    return {
      rows: parsed.rows,
      isFresh: Date.now() - parsed.savedAt < CACHE_MAX_AGE_MS
    };
  } catch {
    return null;
  }
}

function saveCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rows, savedAt: Date.now() }));
  } catch {
    // quota超過時は無視
  }
}

function normalizeArticle(row, index) {
  const date = row['日付'] || row.date || '';
  const title = row['タイトル'] || row.title || `記事${index + 1}`;
  const body = row['本文'] || row.body || '';
  const baseTags = (row['タグ'] || row.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const id = String(row.ID || row.id || `${date}-${title}-${index}`);

  return {
    id,
    title,
    body,
    date,
    genre: row['ジャンル'] || row.genre || '未分類',
    image: row['画像URL'] || row.imageUrl || '',
    tags: state.tagOverrides[id] || baseTags,
    searchText: `${title} ${body}`.toLowerCase(),
    normalizedTitle: normalizeJapanese(title)
  };
}

function bindEvents() {
  let timer;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = normalizeJapanese(el.searchInput.value.trim().toLowerCase());
      applyFilters(true);
    }, 220);
  });

  el.sortSelect.addEventListener('change', () => {
    state.sort = el.sortSelect.value;
    applyFilters(true);
  });

  el.clearTagsBtn.addEventListener('click', () => {
    state.selectedTags.clear();
    renderTagFilters();
    applyFilters(true);
  });

  el.loginBtn.addEventListener('click', () => el.loginDialog.showModal());
  el.logoutBtn.addEventListener('click', logout);

  el.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.usernameInput.value.trim();
    if (!name) return;
    state.user = { name };
    localStorage.setItem('user', JSON.stringify(state.user));
    el.loginDialog.close();
    hydrateSessionUI();
    applyFilters(true);
  });
}

function hydrateSessionUI() {
  el.loginBtn.textContent = state.user ? `${state.user.name} さん` : 'ログイン';
  el.logoutBtn.classList.toggle('hidden', !state.user);
  el.pointBadge.textContent = `ポイント: ${state.points}`;
}

function logout() {
  state.user = null;
  localStorage.removeItem('user');
  hydrateSessionUI();
  applyFilters(true);
}

function renderGenres() {
  const counts = state.all.reduce((acc, a) => {
    acc[a.genre] = (acc[a.genre] || 0) + 1;
    return acc;
  }, {});
  const genres = ['すべて', ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];

  el.genres.innerHTML = '';
  genres.forEach((g) => {
    const btn = document.createElement('button');
    btn.className = `genre-btn ${state.genre === g ? 'active' : ''}`;
    btn.textContent = g === 'すべて' ? `すべて (${state.all.length})` : `${g} (${counts[g]})`;
    btn.addEventListener('click', () => {
      state.genre = g;
      renderGenres();
      applyFilters(true);
    });
    el.genres.appendChild(btn);
  });
}

function renderTagFilters() {
  const tags = [...new Set(state.all.flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
  el.tagList.innerHTML = '';

  tags.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = `tag-filter-btn ${state.selectedTags.has(t) ? 'active' : ''}`;
    btn.textContent = t;
    btn.addEventListener('click', () => {
      if (state.selectedTags.has(t)) state.selectedTags.delete(t);
      else state.selectedTags.add(t);
      renderTagFilters();
      applyFilters(true);
    });
    el.tagList.appendChild(btn);
  });
}

function applyFilters(resetPage = false) {
  let rows = state.all;

  if (state.genre !== 'すべて') rows = rows.filter((r) => r.genre === state.genre);

  if (state.selectedTags.size) {
    const required = [...state.selectedTags];
    rows = rows.filter((r) => required.every((tag) => r.tags.includes(tag)));
  }

  if (state.query) {
    rows = rows.filter((r) => {
      if (r.searchText.includes(state.query)) return true;
      return softFuzzyMatch(r.normalizedTitle, state.query);
    });
  }

  rows = [...rows].sort((a, b) =>
    state.sort === 'dateAsc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
  );

  state.visible = rows;

  if (resetPage) {
    state.page = 0;
    el.articleList.innerHTML = '';
    appendNextBatch();
  }

  el.emptyState.classList.toggle('hidden', state.visible.length > 0);
  renderFavoritePanel();
}

function appendNextBatch() {
  const start = state.page * BATCH;
  const end = start + BATCH;
  const chunk = state.visible.slice(start, end);
  if (!chunk.length) return;

  const frag = document.createDocumentFragment();
  chunk.forEach((a) => frag.appendChild(renderArticle(a)));
  el.articleList.appendChild(frag);
  state.page += 1;
}

function renderArticle(article) {
  const card = document.createElement('article');
  card.className = 'article';

  const fav = state.favorites.has(article.id);
  const read = state.readSet.has(article.id);

  card.innerHTML = `
    <div class="article-head">
      <div class="meta">
        <span>${escapeHtml(article.genre)}</span>
        <span>${escapeHtml(article.date)}</span>
        ${read ? '<span class="read-badge">既読</span>' : '<span>未読</span>'}
      </div>
      <h3 class="title">${escapeHtml(article.title)}</h3>
    </div>
    ${article.image ? `<img class="article-image" src="${escapeAttr(article.image)}" loading="lazy" alt="${escapeAttr(article.title)}">` : ''}
    <div class="article-body">
      ${article.body.split(/\n+/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      <div class="actions">
        <button class="icon-btn fav ${fav ? 'active' : ''}">${fav ? '★ お気に入り済み' : '☆ お気に入り'}</button>
        <button class="icon-btn read">既読にする</button>
        ${state.user ? '<button class="icon-btn edit-tags">タグ編集</button>' : ''}
      </div>
      <div class="tags"></div>
      <div class="comment-box">
        <strong>コメント</strong>
        ${state.user ? '<form class="comment-form"><input required placeholder="コメントを入力" /><button class="btn">送信</button></form>' : '<p>コメントするにはログインしてください。</p>'}
        <ul class="comment-list"></ul>
      </div>
    </div>
  `;

  const tagsEl = card.querySelector('.tags');
  article.tags.forEach((tag) => {
    const chip = document.createElement('button');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)} <a class="wiki" href="https://ja.wikipedia.org/wiki/${encodeURIComponent(tag)}" target="_blank" rel="noopener noreferrer">📘</a>`;
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.wiki')) return;
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      renderTagFilters();
      applyFilters(true);
    });
    tagsEl.appendChild(chip);
  });

  card.querySelector('.fav').addEventListener('click', () => toggleFavorite(article.id));
  card.querySelector('.read').addEventListener('click', () => markRead(article.id));

  if (state.user) {
    card.querySelector('.edit-tags')?.addEventListener('click', () => editTags(article));
    card.querySelector('.comment-form')?.addEventListener('submit', (e) => postComment(e, article.id));
  }

  renderComments(card, article.id);
  return card;
}

function renderComments(card, articleId) {
  const list = card.querySelector('.comment-list');
  const comments = state.comments[articleId] || [];
  list.innerHTML = comments
    .map((c) => `<li class="card"><strong>${escapeHtml(c.user)}</strong>: ${escapeHtml(c.text)}</li>`)
    .join('');
}

function postComment(event, articleId) {
  event.preventDefault();
  const input = event.target.querySelector('input');
  const text = input.value.trim();
  if (!text || !state.user) return;

  const current = state.comments[articleId] || [];
  current.unshift({ user: state.user.name, text, at: Date.now() });
  state.comments[articleId] = current.slice(0, 20);
  localStorage.setItem('commentsByArticle', JSON.stringify(state.comments));
  addPoints(3);
  input.value = '';
  applyFilters(true);
}

function toggleFavorite(articleId) {
  if (state.favorites.has(articleId)) state.favorites.delete(articleId);
  else state.favorites.add(articleId);
  localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
  applyFilters(true);
}

function markRead(articleId) {
  state.readSet.add(articleId);
  localStorage.setItem('readSet', JSON.stringify([...state.readSet]));
  applyFilters(true);
}

function editTags(article) {
  const next = prompt('タグをカンマ区切りで入力', article.tags.join(', '));
  if (next == null) return;

  const tags = next.split(',').map((t) => t.trim()).filter(Boolean);
  state.tagOverrides[article.id] = tags;
  localStorage.setItem('tagOverrides', JSON.stringify(state.tagOverrides));

  state.all = state.all.map((a) => (a.id === article.id ? { ...a, tags } : a));
  renderTagFilters();
  applyFilters(true);
}

function addPoints(points) {
  state.points += points;
  localStorage.setItem('points', String(state.points));
  hydrateSessionUI();
}

function renderFavoritePanel() {
  const favorites = state.all.filter((a) => state.favorites.has(a.id)).slice(0, 20);
  el.favoriteList.innerHTML = favorites.length
    ? favorites
        .map(
          (a) => `<li><button class="icon-btn jump" data-id="${escapeAttr(a.id)}">${escapeHtml(a.title)}</button></li>`
        )
        .join('')
    : '<li>まだありません。</li>';

  el.favoriteList.querySelectorAll('.jump').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-id');
      const target = [...document.querySelectorAll('.article .title')].find((t) =>
        t.textContent?.includes(state.all.find((a) => a.id === targetId)?.title || '')
      );
      target?.closest('.article')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function setupInfiniteScroll() {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) appendNextBatch();
    },
    { rootMargin: '300px' }
  );
  observer.observe(el.sentinel);
}

function notifyNewArticles() {
  const latest = [...state.all].sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const lastSeen = localStorage.getItem('lastSeenDate') || '';

  if (latest && lastSeen && latest > lastSeen) {
    const count = state.all.filter((a) => a.date > lastSeen).length;
    el.newNotice.textContent = `新着記事 ${count} 件があります`;
    el.newNotice.classList.remove('hidden');
  }

  if (latest) localStorage.setItem('lastSeenDate', latest);
}

function normalizeJapanese(value) {
  return value
    .normalize('NFKC')
    .replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

function softFuzzyMatch(text, query) {
  if (!query || query.length < 2) return false;
  if (text.includes(query)) return true;

  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return false;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#96;');
}
