const API_URL = 'https://raspy-sunset-f70a.100nen-data.workers.dev/api/articles';
const CACHE_KEY = 'hyakunen:articles-cache:v1';
const CACHE_AT_KEY = 'hyakunen:articles-cache-at:v1';
const FAVORITES_KEY = 'hyakunen:favorites:v1';
const BATCH_SIZE = 15;
const GALLERY_BATCH = 8;

const state = {
  allArticles: [],
  filtered: [],
  renderedCount: 0,
  galleryArticles: [],
  galleryRendered: 0,
  keyword: '',
  sort: 'dateDesc',
  genre: 'すべて',
  selectedTags: new Set(),
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')),
  currentView: 'home',
};

const els = {
  homeView: document.getElementById('homeView'),
  tagsView: document.getElementById('tagsView'),
  galleryView: document.getElementById('galleryView'),
  mypageView: document.getElementById('mypageView'),
  navButtons: [...document.querySelectorAll('.top-nav-btn')],
  searchInput: document.getElementById('searchInput'),
  sortSelect: document.getElementById('sortSelect'),
  genreStrip: document.getElementById('genreStrip'),
  statusLine: document.getElementById('statusLine'),
  newsList: document.getElementById('newsList'),
  tagCloud: document.getElementById('tagCloud'),
  allTagsList: document.getElementById('allTagsList'),
  selectedTags: document.getElementById('selectedTags'),
  clearTagsBtn: document.getElementById('clearTagsBtn'),
  goTagsPageBtn: document.getElementById('goTagsPageBtn'),
  sentinel: document.getElementById('sentinel'),
  galleryFeed: document.getElementById('galleryFeed'),
  gallerySentinel: document.getElementById('gallerySentinel'),
  favoriteSummary: document.getElementById('favoriteSummary'),
  favoriteList: document.getElementById('favoriteList'),
  articleTemplate: document.getElementById('articleTemplate'),
  imageModal: document.getElementById('imageModal'),
  modalImage: document.getElementById('modalImage'),
  closeModalBtn: document.getElementById('closeModalBtn'),
};

const wikiIcon = 'https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg';

bootstrap();

async function bootstrap() {
  bindEvents();
  readQuery();
  await loadArticlesFast();
  buildGenreButtons();
  buildTagViews();
  applyFilters(true);
  setupInfiniteScroll();
  setupGalleryScroll();
  renderMypage();
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  els.searchInput.addEventListener('input', () => {
    state.keyword = els.searchInput.value.trim();
    applyFilters(true);
  });

  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    applyFilters(true);
  });

  els.clearTagsBtn.addEventListener('click', () => {
    state.selectedTags.clear();
    applyFilters(true);
  });

  els.goTagsPageBtn.addEventListener('click', () => switchView('tags'));

  els.closeModalBtn.addEventListener('click', closeModal);
  els.imageModal.addEventListener('click', (event) => {
    if (event.target === els.imageModal) closeModal();
  });
}

function switchView(view) {
  state.currentView = view;
  els.homeView.classList.toggle('hidden', view !== 'home');
  els.tagsView.classList.toggle('hidden', view !== 'tags');
  els.galleryView.classList.toggle('hidden', view !== 'gallery');
  els.mypageView.classList.toggle('hidden', view !== 'mypage');
  els.navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));

  if (view === 'mypage') renderMypage();
  if (view === 'gallery' && els.galleryFeed.childElementCount === 0) appendGalleryBatch();
}

async function loadArticlesFast() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      state.allArticles = JSON.parse(cached);
      const at = localStorage.getItem(CACHE_AT_KEY);
      els.statusLine.textContent = at ? `キャッシュ表示中（${new Date(Number(at)).toLocaleString('ja-JP')}）` : 'キャッシュ表示中';
    } catch {
      localStorage.removeItem(CACHE_KEY);
    }
  }

  const res = await fetch(API_URL);
  if (!res.ok && state.allArticles.length === 0) {
    els.statusLine.textContent = '記事の読み込みに失敗しました。';
    throw new Error('fetch failed');
  }

  if (res.ok) {
    const fresh = await res.json();
    state.allArticles = fresh;
    localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    localStorage.setItem(CACHE_AT_KEY, String(Date.now()));
  }
}

function buildGenreButtons() {
  const counts = new Map([['すべて', state.allArticles.length]]);
  for (const item of state.allArticles) {
    const genre = item['ジャンル'] || '未分類';
    counts.set(genre, (counts.get(genre) || 0) + 1);
  }

  els.genreStrip.innerHTML = '';
  [...counts.entries()]
    .sort((a, b) => (a[0] === 'すべて' ? -1 : b[0] === 'すべて' ? 1 : b[1] - a[1]))
    .forEach(([genre, count]) => {
      const btn = document.createElement('button');
      btn.className = 'genre-btn';
      btn.textContent = `${genre} (${count})`;
      if (genre === state.genre) btn.classList.add('active');
      btn.addEventListener('click', () => {
        state.genre = genre;
        [...els.genreStrip.children].forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        applyFilters(true);
      });
      els.genreStrip.appendChild(btn);
    });
}

function buildTagViews() {
  const tagCount = countTags(state.allArticles);
  const sortedTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);

  renderTagButtons(els.tagCloud, sortedTags.slice(0, 10));
  renderTagButtons(els.allTagsList, sortedTags);
}

function renderTagButtons(target, entries) {
  target.innerHTML = '';
  entries.forEach(([tag, count]) => {
    const btn = document.createElement('button');
    btn.className = 'cloud-chip';
    btn.type = 'button';
    btn.textContent = `${tag} (${count})`;
    btn.addEventListener('click', () => {
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      switchView('home');
      applyFilters(true);
    });
    target.appendChild(btn);
  });
}

function applyFilters(reset = false) {
  let list = [...state.allArticles];

  if (state.genre !== 'すべて') list = list.filter((a) => (a['ジャンル'] || '未分類') === state.genre);

  if (state.selectedTags.size > 0) {
    list = list.filter((a) => {
      const tags = new Set(parseTags(a['タグ']));
      return [...state.selectedTags].every((tag) => tags.has(tag));
    });
  }

  const keyword = normalize(state.keyword);
  if (keyword) {
    list = list.filter((a) => {
      const title = normalize(a['タイトル'] || '');
      const body = normalize(a['本文'] || '');
      return includesFuzzy(title, keyword) || includesFuzzy(body, keyword);
    });
  }

  list.sort((a, b) => {
    const dA = normalizeDate(a['日付']);
    const dB = normalizeDate(b['日付']);
    return state.sort === 'dateAsc' ? dA.localeCompare(dB) : dB.localeCompare(dA);
  });

  state.filtered = list;
  state.galleryArticles = list.filter((a) => !!a['画像URL']);

  if (reset) {
    state.renderedCount = 0;
    els.newsList.innerHTML = '';
    appendBatch();

    state.galleryRendered = 0;
    els.galleryFeed.innerHTML = '';
    if (state.currentView === 'gallery') appendGalleryBatch();
  }

  renderSelectedTags();
  syncTagButtonState();
  updateStatus();
  writeQuery();
}

function appendBatch() {
  const batch = state.filtered.slice(state.renderedCount, state.renderedCount + BATCH_SIZE);
  if (batch.length === 0) return;

  const fragment = document.createDocumentFragment();
  batch.forEach((article) => fragment.appendChild(renderArticleCard(article, false)));
  els.newsList.appendChild(fragment);
  state.renderedCount += batch.length;
}

function appendGalleryBatch() {
  const batch = state.galleryArticles.slice(state.galleryRendered, state.galleryRendered + GALLERY_BATCH);
  if (batch.length === 0) return;

  const fragment = document.createDocumentFragment();
  batch.forEach((article) => {
    const card = document.createElement('article');
    card.className = 'gallery-card';

    const image = document.createElement('img');
    image.className = 'gallery-image';
    image.src = article['画像URL'];
    image.alt = article['タイトル'] || '記事画像';
    image.loading = 'lazy';
    image.addEventListener('click', () => openModal(image.src, image.alt));

    const title = document.createElement('h3');
    title.className = 'gallery-title';
    title.textContent = article['タイトル'] || '無題';

    const body = document.createElement('p');
    body.className = 'gallery-body';
    body.textContent = makeSnippet(article['本文'] || '', 220);

    card.append(image, title, body);
    fragment.appendChild(card);
  });

  els.galleryFeed.appendChild(fragment);
  state.galleryRendered += batch.length;
}

function renderArticleCard(article, isMypage) {
  const node = els.articleTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.genre-pill').textContent = article['ジャンル'] || '未分類';
  node.querySelector('.article-date').textContent = article['日付'] || '';
  node.querySelector('.article-title').textContent = article['タイトル'] || '無題';
  node.querySelector('.article-snippet').textContent = makeSnippet(article['本文'] || '', 160);

  const favBtn = node.querySelector('.favorite-btn');
  const articleId = getArticleId(article);
  const isFav = state.favorites.has(articleId);
  favBtn.classList.toggle('active', isFav);
  favBtn.textContent = isFav ? '★ お気に入り中' : '☆ お気に入り';
  favBtn.addEventListener('click', () => toggleFavorite(article));

  const image = node.querySelector('.article-image');
  if (article['画像URL']) {
    image.src = article['画像URL'];
    image.classList.remove('hidden');
    image.addEventListener('click', () => openModal(image.src, article['タイトル'] || '記事画像'));
  }

  const tagBox = node.querySelector('.article-tags');
  parseTags(article['タグ']).forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';

    const text = document.createElement('button');
    text.className = 'tag-chip';
    text.type = 'button';
    text.textContent = `#${tag}`;
    text.addEventListener('click', () => {
      state.selectedTags.add(tag);
      switchView('home');
      applyFilters(true);
    });

    const wiki = document.createElement('a');
    wiki.className = 'wiki-link';
    wiki.href = `https://ja.wikipedia.org/wiki/${encodeURIComponent(tag)}`;
    wiki.target = '_blank';
    wiki.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.src = wikiIcon;
    img.alt = 'Wikipedia';
    wiki.appendChild(img);

    chip.append(text, wiki);
    tagBox.appendChild(chip);
  });

  if (isMypage) {
    const remove = document.createElement('button');
    remove.className = 'ghost';
    remove.type = 'button';
    remove.textContent = 'お気に入りから外す';
    remove.addEventListener('click', () => toggleFavorite(article));
    node.appendChild(remove);
  }

  return node;
}

function renderMypage() {
  const favorites = state.allArticles.filter((article) => state.favorites.has(getArticleId(article)));
  els.favoriteSummary.textContent = `お気に入り ${favorites.length} 件（ブラウザ保存）`;
  els.favoriteList.innerHTML = '';

  if (favorites.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'まだお気に入りはありません。';
    els.favoriteList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  favorites.forEach((article) => fragment.appendChild(renderArticleCard(article, true)));
  els.favoriteList.appendChild(fragment);
}

function toggleFavorite(article) {
  const id = getArticleId(article);
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);

  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  applyFilters(true);
  renderMypage();
}

function setupInfiniteScroll() {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && state.currentView === 'home') {
      appendBatch();
      updateStatus();
    }
  }, { rootMargin: '280px 0px' });
  observer.observe(els.sentinel);
}

function setupGalleryScroll() {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && state.currentView === 'gallery') {
      appendGalleryBatch();
    }
  }, { rootMargin: '360px 0px' });
  observer.observe(els.gallerySentinel);
}

function openModal(src, alt) {
  els.modalImage.src = src;
  els.modalImage.alt = alt;
  els.imageModal.classList.remove('hidden');
}

function closeModal() {
  els.imageModal.classList.add('hidden');
  els.modalImage.src = '';
}

function renderSelectedTags() {
  els.selectedTags.innerHTML = '';
  [...state.selectedTags].sort((a, b) => a.localeCompare(b, 'ja')).forEach((tag) => {
    const button = document.createElement('button');
    button.className = 'selected-chip';
    button.type = 'button';
    button.textContent = `#${tag} ×`;
    button.addEventListener('click', () => {
      state.selectedTags.delete(tag);
      applyFilters(true);
    });
    els.selectedTags.appendChild(button);
  });
}

function syncTagButtonState() {
  const all = [...els.tagCloud.children, ...els.allTagsList.children];
  all.forEach((button) => {
    const tag = button.textContent.replace(/\s*\(\d+\)$/, '');
    button.classList.toggle('active', state.selectedTags.has(tag));
  });
}

function updateStatus() {
  const total = state.filtered.length;
  const shown = Math.min(state.renderedCount, total);
  els.statusLine.textContent = `${shown} / ${total} 件を表示中`;
}

function parseTags(raw) {
  return (raw || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function countTags(articles) {
  const map = new Map();
  articles.forEach((article) => {
    parseTags(article['タグ']).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
  });
  return map;
}

function getArticleId(article) {
  return `${article['日付'] || ''}-${article['タイトル'] || ''}`;
}

function makeSnippet(body, length) {
  const plain = body.replace(/\s+/g, ' ').trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

function normalize(text) {
  return (text || '').toLowerCase().normalize('NFKC').trim();
}

function normalizeDate(value) {
  return (value || '').replaceAll('-', '').replaceAll('/', '');
}

function includesFuzzy(text, keyword) {
  if (text.includes(keyword)) return true;
  if (keyword.length <= 2) return false;

  const chars = [...keyword];
  let index = 0;
  for (const char of text) {
    if (char === chars[index]) index += 1;
    if (index >= chars.length) return true;
  }
  return false;
}

function writeQuery() {
  const params = new URLSearchParams();
  if (state.keyword) params.set('q', state.keyword);
  if (state.sort !== 'dateDesc') params.set('sort', state.sort);
  if (state.genre !== 'すべて') params.set('genre', state.genre);
  if (state.selectedTags.size > 0) params.set('tags', [...state.selectedTags].join(','));
  if (state.currentView !== 'home') params.set('view', state.currentView);
  history.replaceState(null, '', params.toString() ? `?${params.toString()}` : location.pathname);
}

function readQuery() {
  const params = new URLSearchParams(location.search);
  state.keyword = params.get('q') || '';
  state.sort = params.get('sort') || 'dateDesc';
  state.genre = params.get('genre') || 'すべて';
  const tags = (params.get('tags') || '').split(',').map((v) => v.trim()).filter(Boolean);
  tags.forEach((tag) => state.selectedTags.add(tag));

  const view = params.get('view');
  if (view && ['home', 'tags', 'gallery', 'mypage'].includes(view)) {
    state.currentView = view;
  }

  els.searchInput.value = state.keyword;
  els.sortSelect.value = state.sort;
  switchView(state.currentView);
}
