if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('Service Worker registered!', reg);

    reg.onupdatefound = () => {
      const newWorker = reg.installing;
      newWorker.onstatechange = () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateNotice();
        }
      };
    };
  }).catch(err => {
    console.error('Service Worker registration failed:', err);
  });
}

function showUpdateNotice() {
  const notice = document.getElementById('updateNotice');
  if (!notice) return;

  notice.style.display = 'block';
  notice.style.opacity = '1';

  // 5秒でフェードアウト（ただしタップされなければ）
  setTimeout(() => {
    notice.style.opacity = '0';
    setTimeout(() => { notice.style.display = 'none'; }, 500);
  }, 5000);

  // タップで即リロード
  notice.addEventListener('click', () => {
    location.reload();
  });
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
const isInStandaloneMode = ('standalone' in window.navigator) && window.navigator.standalone;

if (isIos && !isInStandaloneMode) {
  document.getElementById('ios-tip').style.display = 'block';
}

let allArticles = [];
let currentImageIndex = 0;
let currentGenre = 'すべて';
let visibleImageArticles = [];
let visibleCount = 0;
const BATCH_SIZE = 20;
let thumbnailPage = 0;
const thumbnailsPerPage = 20;
let filteredThumbnailArticles = [];
let isLoading = false;

fetch('https://raspy-sunset-f70a.100nen-data.workers.dev/api/articles')
  .then(response => {
    if (!response.ok) {
      throw new Error('記事データの取得に失敗しました');
    }
    return response.json();
  })
  .then(data => {
    allArticles = data;

    const filtersDiv = document.getElementById("genres");
    filtersDiv.innerHTML = "";

    // ジャンル件数を数える
    const genreCounts = data.reduce((acc, article) => {
      const genre = article["ジャンル"] || "未分類";
      acc[genre] = (acc[genre] || 0) + 1;
      return acc;
    }, {});

    // 画像あり件数
    const imageCount = data.filter(article => !!article["画像URL"]).length;

    // ソート（件数の多い順）
    const sortedGenres = Object.entries(genreCounts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // 数値で降順
      return a[0].localeCompare(b[0], 'ja'); // 同点なら五十音順
    });

    // 「すべて」ボタン
    const allBtn = document.createElement("button");
    allBtn.textContent = `すべて (${data.length})`;
    allBtn.onclick = () => {
      currentGenre = 'すべて';
      highlightActiveButton(allBtn);
      applyFilters();
    };
    filtersDiv.appendChild(allBtn);
    allBtn.onclick();
    
    // 「画像あり」ボタン
    const imageBtn = document.createElement("button");
    imageBtn.textContent = `画像あり (${imageCount})`;
    imageBtn.onclick = () => {
      currentGenre = '画像あり';
      highlightActiveButton(imageBtn);
      applyFilters();
    };
    filtersDiv.appendChild(imageBtn);

    // その他のジャンルボタン
    sortedGenres.forEach(([genre, count]) => {
      const btn = document.createElement("button");
      btn.textContent = `${genre} (${count})`;
      btn.onclick = () => {
        currentGenre = genre;
        highlightActiveButton(btn);
        applyFilters();
      };
      filtersDiv.appendChild(btn);
    });

    const tags = extractUniqueTags(data);
    renderTagButtons(tags);

    applyFilters();
  })
  .catch(error => {
    console.error('データ取得エラー:', error);
    document.getElementById("app").textContent = "記事の読み込みに失敗しました。";
  });

function applyFilters() {
  const container = document.getElementById("news");
  container.innerHTML = "";
  visibleCount = 0;

  const keyword = document.getElementById("searchInput").value.toLowerCase();
  const tagArray = Array.from(selectedTags);
  let filtered = allArticles;

  if (currentGenre === '画像あり') {
    filtered = filtered.filter(article => !!article["画像URL"]);
  } else if (currentGenre !== 'すべて') {
    filtered = filtered.filter(article => article["ジャンル"] === currentGenre);
  }

  if (tagArray.length > 0) {
    filtered = filtered.filter(article => {
      const tags = article["タグ"]
        ? article["タグ"].split(",").map(tag => tag.trim())
        : [];
      return tagArray.every(tag => tags.includes(tag));
    });
  }

  if (keyword) {
    filtered = filtered.filter(article =>
      (article["タイトル"] || "").toLowerCase().includes(keyword) ||
      (article["本文"] || "").toLowerCase().includes(keyword)
    );
  }

  const sortType = document.getElementById("sortSelect")?.value;
  
  filtered.sort((a, b) => {
    switch (sortType) {
      case "relevance":
        const getScore = (item) => {
          let score = 0;
          if (!keyword) return score;
          const title = item["タイトル"]?.toLowerCase() || "";
          const body = item["本文"]?.toLowerCase() || "";
  
          // タイトルに含まれていれば +3
          if (title.includes(keyword)) score += 3;
          // 本文に含まれていれば +1
          if (body.includes(keyword)) score += 1;
  
          return score;
        };
        return getScore(b) - getScore(a); // 高スコア順
      case "dateAsc":
        return a["日付"]?.localeCompare(b["日付"]);
      case "dateDesc":
        return b["日付"]?.localeCompare(a["日付"]);
      default:
        return 0;
    }
  });


  window.filteredArticles = filtered;
  const noResultsEl = document.getElementById("noResults");

  if (filtered.length === 0) {
    container.innerHTML = "";
    document.getElementById("thumbnailGallery").innerHTML = "";
    document.getElementById("scrollSentinel").style.display = "none";
    if (noResultsEl) noResultsEl.classList.remove("hidden");
    return;
  } else {
    if (noResultsEl) noResultsEl.classList.add("hidden");
    document.getElementById("scrollSentinel").style.display = "";
  }

  // サムネイル更新
  const gallery = document.getElementById("thumbnailGallery");
  gallery.innerHTML = "";
  filteredThumbnailArticles = filtered.filter(article => !!article["画像URL"]);
  thumbnailPage = 0;
  renderThumbnailPage();
  visibleImageArticles = filteredThumbnailArticles;

  visibleCount = 0;
  loadMore(); // 最初の分だけ表示

  function fillViewportIfNeeded() {
    const sentinel = document.getElementById("scrollSentinel");
    const containerHeight = container.offsetHeight;
    const windowHeight = window.innerHeight;

    // 記事が画面に満たないか、sentinel がまだ下にあるときは続ける
    if (
      visibleCount < window.filteredArticles.length &&
      containerHeight < windowHeight + 100 &&
      !isLoading
    ) {
      loadMore();
      setTimeout(fillViewportIfNeeded, 50);
    }
  }

  setTimeout(fillViewportIfNeeded, 100); // 初期レンダリング後に開始

  checkInitialScrollability();
  setupScrollSentinel();
}

async function loadMore() {
  if (!window.filteredArticles || !Array.isArray(window.filteredArticles)) return;
  if (isLoading) return;
  isLoading = true;

  const container = document.getElementById("news");
  const end = visibleCount + BATCH_SIZE;
  const nextBatch = window.filteredArticles.slice(visibleCount, end);

  for (const article of nextBatch) {
    const rawTags = (article["タグ"] || "")
      .split(",")
      .map(tag => tag.trim())
      .filter(tag => tag);

    const tags = await buildTagHTML(rawTags);

    container.innerHTML += `
      <div class="article">
        <div class="genre">${article["ジャンル"]}</div>
        <div class="title">${article["タイトル"]}</div>
        <div class="date">${article["日付"]}</div>
        ${article["画像URL"] ? `<img src="${article["画像URL"]}" loading="lazy" class="article-image" onclick="openModal('${article["画像URL"]}')">` : ""}
        <div class="article-body">&emsp;${(article["本文"] || "").replace(/\n/g, "<br>&emsp;")}</div>
        <div class="tags">${tags}</div>
      </div>
    `;
  }

  // タグクリックで絞り込み
  const clickableTags = container.querySelectorAll(".clickable-tag"); 
  clickableTags.forEach(tagEl => {
    tagEl.addEventListener("click", event => {
      if (event.target.closest(".wikipedia-icon")) {
        return; // Wikipediaアイコンのクリックだったら何もしない
      }
  
      const tag = tagEl.getAttribute("data-tag");
  
      // 単一選択モード
      selectedTags.clear();
      selectedTags.add(tag);
  
      // タグ一覧にも反映
      updateTagButtonStates();
  
      // フィルター反映
      applyFilters();
    });
  });

  visibleCount += nextBatch.length;

  setTimeout(() => {
    isLoading = false;
    checkInitialScrollability(); // ← 再度チェック（記事が画面に足りないとき用）
  }, 300);

  await addWikipediaIcons();

}

function setupScrollSentinel() {
  let sentinel = document.getElementById("scrollSentinel");
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.id = "scrollSentinel";
    document.body.appendChild(sentinel);
  }

  if (window._observer) {
    window._observer.disconnect();
  }

  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  }, {
    rootMargin: "200px",
  });

  observer.observe(sentinel);
  window._observer = observer;
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < window.innerHeight &&
    rect.bottom >= 0
  );
}

function setupIntersectionObserver() {
  const sentinel = document.getElementById("scrollSentinel");
  if (!sentinel) return;

  // すでに observer があるなら切る
  if (window._observer) {
    window._observer.disconnect();
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  }, {
    rootMargin: "400px",
  });

  observer.observe(sentinel);
  window._observer = observer;
}

// ページの高さが画面に満たないときに繰り返し読み込む
function checkInitialScrollability() {
  const documentHeight = document.body.offsetHeight;
  const windowHeight = window.innerHeight;

  if (documentHeight <= windowHeight + 100 && !isLoading) {
    loadMore();
    setTimeout(checkInitialScrollability, 300);
  }
}

// 画面スクロール時に最下部近くで読み込み（補助的）
function maybeLoadMoreArticles() {
  if (isLoading) return;

  const scrollBottom = window.innerHeight + window.scrollY;
  const documentHeight = document.body.offsetHeight;

  if (scrollBottom + 300 >= documentHeight) {
    loadMore();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupScrollSentinel();
});

window.addEventListener("scroll", maybeLoadMoreArticles);

document.addEventListener("DOMContentLoaded", () => {
  const sentinel = document.createElement("div");
  sentinel.id = "scrollSentinel";
  document.body.appendChild(sentinel);
  setupIntersectionObserver();
  checkInitialScrollability(); // ← 初期表示が少ない時に対応
});

function renderThumbnailPage() {
  const gallery = document.getElementById("thumbnailGallery");
  const start = thumbnailPage * thumbnailsPerPage;
  const end = start + thumbnailsPerPage;
  const slice = filteredThumbnailArticles.slice(start, end);

  slice.forEach(article => {
    const img = document.createElement("img");
    img.src = article["画像URL"];
    img.className = "thumbnail";
    img.loading = "lazy";
    img.onclick = () => openModal(article["画像URL"]);
    gallery.appendChild(img);
  });

  thumbnailPage++;
}

function setGenre(genre) {
  currentGenre = genre;
  applyFilters();
}

function highlightActiveButton(activeBtn) {
  const buttons = document.querySelectorAll("#genres button");
  buttons.forEach(btn => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

// 記事データ（getArticles()で取得済み）を使ってタグ一覧を作る
function extractUniqueTags(articles) {
  const tagCounts = {};

  articles.forEach(article => {
    if (!article["タグ"]) return;
    const tags = article["タグ"]
      .split(",")
      .map(tag => tag.trim())
      .filter(tag => tag !== "");

    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  // 件数の多い順 → 同じなら五十音順（日本語対応）でソート
  return Object.entries(tagCounts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'ja');
  });
}

const selectedTags = new Set();

function renderTagButtons(tagsWithCounts, showAll = false) {
  const container = document.getElementById("tag-buttons");
  const toggleBtn = document.getElementById("toggle-tags");
  const clearBtn = document.getElementById("clear-tags");

  container.innerHTML = "";

  const MAX_VISIBLE = 20;
  const tagsToRender = showAll ? tagsWithCounts : tagsWithCounts.slice(0, MAX_VISIBLE);

  tagsToRender.forEach(([tag, count]) => {
    const btn = document.createElement("button");
    btn.textContent = `#${tag} (${count})`;
    btn.classList.add("tag-button");
    btn.setAttribute("data-tag", tag);

    if (selectedTags.has(tag)) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        btn.classList.remove("active");
      } else {
        selectedTags.add(tag);
        btn.classList.add("active");
      }
      applyFilters();
    });

    container.appendChild(btn);
  });

  // イベントリスナーの更新
  toggleBtn.innerHTML = showAll ? "▲ 折りたたむ" : "▼ もっと見る";
  toggleBtn.onclick = () => renderTagButtons(tagsWithCounts, !showAll);

  clearBtn.onclick = () => {
    selectedTags.clear();
    document.querySelectorAll(".tag-button").forEach(btn => btn.classList.remove("active"));
    applyFilters();
  };
}

const WIKIPEDIA_CACHE_KEY = "wikipediaExistenceCache";
const WIKIPEDIA_CACHE_EXPIRY_DAYS = 30;

function getWikipediaCache() {
  const raw = localStorage.getItem(WIKIPEDIA_CACHE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveWikipediaCache(cache) {
  localStorage.setItem(WIKIPEDIA_CACHE_KEY, JSON.stringify(cache));
}

function getRandomExpiryDate() {
  const days = WIKIPEDIA_CACHE_EXPIRY_DAYS * (1 + Math.random()); // 30〜60日
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}

function isCacheExpired(expiryDate) {
  return new Date() > new Date(expiryDate);
}

async function checkWikipediaExistence(title) {
  const cache = getWikipediaCache();
  if (
    cache[title] &&
    !isCacheExpired(cache[title].expiry) &&
    typeof cache[title].redirectTo !== "undefined"
  ) {
    return cache[title]; // { exists, redirectTo }
  }

  try {
    const apiUrl = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&titles=${encodeURIComponent(title)}&redirects=1&format=json`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    const pages = data.query.pages;
    const page = Object.values(pages)[0];
    const exists = page.pageid !== undefined;
    const redirectTo = page.title;

    // 保存
    cache[title] = {
      exists,
      redirectTo,
      expiry: getRandomExpiryDate().toISOString()
    };
    saveWikipediaCache(cache);

    return cache[title];

  } catch (e) {
    console.error("Wikipediaチェック失敗:", title, e);
    return { exists: false, redirectTo: title };
  }
}

function buildTagHTML(tags) {
  const cache = getWikipediaCache();
  const uniqueTags = [...new Set(tags)];

  return uniqueTags.map(tag => {
    const cached = cache[tag];
    const isValid = cached && !isCacheExpired(cached.expiry);
    const exists = isValid ? cached.exists : null;
    const redirectTo = isValid ? cached.redirectTo : null;

    const wikipediaIcon = exists
      ? generateWikipediaIcon(tag, redirectTo)
      : `<span class="wikipedia-placeholder"></span>`;

    return `<span class="clickable-tag" data-tag="${tag}" data-wikipediatag="${tag}">
              #${tag}${wikipediaIcon}
            </span>`;
  }).join("");
}

function addWikipediaIcons() {
  const observer = new IntersectionObserver(async (entries, obs) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const span = entry.target.querySelector(".wikipedia-placeholder");
        if (!span) {
          obs.unobserve(entry.target);
          continue;
        }

        const tag = entry.target.getAttribute("data-wikipediatag");
        const result = await checkWikipediaExistence(tag);
        if (result.exists) {
          span.outerHTML = generateWikipediaIcon(tag, result.redirectTo);
        } else {
          span.remove();
        }
        obs.unobserve(entry.target); // 一度処理したら監視解除
      }
    }
  }, {
    rootMargin: "200px", // 画面に入る前に処理する余裕を持つ
    threshold: 0.1
  });

  document.querySelectorAll(".clickable-tag[data-wikipediatag]").forEach(el => {
    observer.observe(el);
  });
}

function generateWikipediaIcon(tag, actualTitle) {
  const finalTitle = actualTitle || tag;
  const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(finalTitle)}`;
  return `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="wikipedia-icon" title="Wikipediaで「${tag}」を検索">
      <img src="https://upload.wikimedia.org/wikipedia/commons/5/5a/Wikipedia%27s_W.svg" alt="Wikipedia" />
    </a>`;
}

function updateTagButtonStates() {
  document.querySelectorAll(".tag-button").forEach(btn => {
    const btnTag = btn.getAttribute("data-tag");
    if (selectedTags.has(btnTag)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function openModal(imageUrl) {
  currentImageIndex = visibleImageArticles.findIndex(a => a["画像URL"] === imageUrl);
  showImage(currentImageIndex);
  const modal = document.getElementById("imageModal");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.add("show");
  }, 10);
}

function showImage(index) {
  if (index < 0 || index >= visibleImageArticles.length) return;

  currentImageIndex = index;
  const article = visibleImageArticles[index];
  const modalImg = document.getElementById("modalImg");
  modalImg.src = article["画像URL"];
}

function nextImage() {
  showImage(currentImageIndex + 1);
}

function prevImage() {
  showImage(currentImageIndex - 1);
}

function closeModal() {
  const modal = document.getElementById("imageModal");
  modal.classList.remove("show");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

function switchTab(tab) {
  const news = document.getElementById("news");
  const gallery = document.getElementById("thumbnailGallery");
  const tagFilter = document.getElementById("tag-filter");
  const thumbnailTitle = document.querySelector("h2"); // 🖼️ サムネイル一覧

  const isMobile = window.innerWidth < 800;

  // タブのアクティブ状態を切り替え
  const tabButtons = document.querySelectorAll("#tab-buttons button");
  tabButtons.forEach(btn => btn.classList.remove("active"));
  const currentButton = Array.from(tabButtons).find(btn => btn.textContent.includes(tab === "articles" ? "記事" : tab === "tags" ? "タグ" : "画像"));
  if (currentButton) currentButton.classList.add("active");

  if (isMobile) {
    // スマホの場合は全部非表示にしてから、必要なものだけ表示
    news.style.display = "none";
    tagFilter.style.display = "none";
    gallery.style.display = "none";
    if (thumbnailTitle) thumbnailTitle.style.display = "none";

    if (tab === "articles") {
      news.style.display = "";
    } else if (tab === "tags") {
      tagFilter.style.display = "";
    } else if (tab === "thumbnails") {
      gallery.style.display = "";
      if (thumbnailTitle) thumbnailTitle.style.display = "";
    }

  } else {
    // PC時は全部表示
    news.style.display = "";
    tagFilter.style.display = "";
    gallery.style.display = "";
    if (thumbnailTitle) thumbnailTitle.style.display = "";
  }
}

window.onresize = function () {
  // タブの状態を取得（articles or gallery）
  const currentTab = document.getElementById("news").classList.contains("active") ? "articles" : "gallery";

  // 再度 switchTab を呼び出して、表示を最適化
  switchTab(currentTab);
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.innerWidth < 800) {
    switchTab("articles");
  } else {
    document.getElementById("news").classList.add("active");
    document.getElementById("thumbnailGallery").classList.add("active");
  }
});

const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) {
    loadMore();
  }
}, {
  rootMargin: "200px",
});

window.addEventListener("scroll", () => {
  const scrollBottom = window.innerHeight + window.scrollY;
  const documentHeight = document.body.offsetHeight;

  if (scrollBottom + 300 >= documentHeight) {
    if (thumbnailPage * thumbnailsPerPage < filteredThumbnailArticles.length) {
      renderThumbnailPage();
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const sentinel = document.createElement("div");
  sentinel.id = "scrollSentinel";
  document.body.appendChild(sentinel);
  observer.observe(sentinel);
});

document.addEventListener("DOMContentLoaded", () => {
  // sentinel（IntersectionObserver用）を追加
  const sentinel = document.createElement("div");
  sentinel.id = "scrollSentinel";
  document.body.appendChild(sentinel);

  // モーダルの初期化
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("modalImg");
  const closeBtn = document.getElementById("closeBtn");

  closeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeModal();
  });

  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      closeModal();
    } else if (e.target === modalImg) {
      const midpoint = window.innerWidth / 2;
      if (e.clientX < midpoint) {
        prevImage();
      } else {
        nextImage();
      }
    }
  });
});

document.addEventListener("keydown", function(e) {
  const modal = document.getElementById("imageModal");
  if (!modal.classList.contains("show")) return;

  if (e.key === "ArrowRight") {
    nextImage();
  } else if (e.key === "ArrowLeft") {
    prevImage();
  } else if (e.key === "Escape") {
    closeModal();
  }
});

// 表示制御
window.addEventListener("scroll", () => {
  const btn = document.getElementById("scrollToTop");
  btn.style.display = window.scrollY > 300 ? "block" : "none";
});

// スクロール挙動
document.getElementById("scrollToTop").addEventListener("click", () => {
  window.scrollTo({top: 0, behavior: 'smooth'});
});



