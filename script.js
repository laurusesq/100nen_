if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('Service Worker registered!', reg))
    .catch(err => console.error('Service Worker registration failed:', err));
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

    const filtersDiv = document.getElementById("filters");
    filtersDiv.innerHTML = "";

    // ✅ ジャンル件数を数える
    const genreCounts = data.reduce((acc, article) => {
      const genre = article["ジャンル"] || "未分類";
      acc[genre] = (acc[genre] || 0) + 1;
      return acc;
    }, {});

    // ✅ 画像あり件数
    const imageCount = data.filter(article => !!article["画像URL"]).length;

    // ✅ ソート（件数の多い順）
    const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);

    // 「すべて」ボタン
    const allBtn = document.createElement("button");
    allBtn.textContent = `すべて (${data.length})`;
    allBtn.onclick = () => {
      currentGenre = 'すべて';
      highlightActiveButton(allBtn);
      applyFilters();
    };
    filtersDiv.appendChild(allBtn);

    // 「画像あり」ボタン
    const imageBtn = document.createElement("button");
    imageBtn.textContent = `画像あり (${imageCount})`;
    imageBtn.onclick = () => {
      currentGenre = '画像あり';
      highlightActiveButton(imageBtn);
      applyFilters();
    };
    filtersDiv.appendChild(imageBtn);

    // ジャンルボタンたち
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
      (article["本文"] || "").toLowerCase().includes(keyword) ||
      (article["著者"] || "").toLowerCase().includes(keyword)
    );
  }

  const sortType = document.getElementById("sortSelect")?.value;
  filtered.sort((a, b) => {
    switch (sortType) {
      case "dateAsc":
        return a["日付"]?.localeCompare(b["日付"]);
      case "dateDesc":
        return b["日付"]?.localeCompare(a["日付"]);
      case "authorAsc":
        return (a["著者"] || "").localeCompare(b["著者"] || "");
      case "authorDesc":
        return (b["著者"] || "").localeCompare(a["著者"] || "");
      case "titleAsc":
        return (a["タイトル"] || "").localeCompare(b["タイトル"] || "");
      case "titleDesc":
        return (b["タイトル"] || "").localeCompare(a["タイトル"] || "");
      case "hasImage":
        return (b["画像URL"] ? 1 : 0) - (a["画像URL"] ? 1 : 0);
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

  // サムネ更新
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

function loadMore() {
  if (!window.filteredArticles || !Array.isArray(window.filteredArticles)) {
    return;
  }

  if (isLoading) return;
  isLoading = true;

  const container = document.getElementById("news");
  const end = visibleCount + BATCH_SIZE;
  const nextBatch = window.filteredArticles.slice(visibleCount, end);

  nextBatch.forEach((article, i) => {
    const tags = (article["タグ"] || "")
      .split(",")
      .map(tag => tag.trim())
      .filter(tag => tag)
      .map(tag => `<span class="tag-label clickable-tag" data-tag="${tag}">#${tag}</span>`)
      .join(" ");

    container.innerHTML += `
      <div class="article">
        <div class="genre">${article["ジャンル"]}</div>
        <div class="title">${article["タイトル"]}</div>
        ${article["画像URL"] ? `<img src="${article["画像URL"]}" loading="lazy" class="article-image" onclick="openModal('${article["画像URL"]}')">` : ""}
        <div class="body">${article["本文"]}</div>
        <div class="author">— ${article["著者"]}（${article["日付"]}）</div>
        <div class="tags">${tags}</div>
      </div>
    `;
  });

  // タグクリックで絞り込み
  const clickableTags = container.querySelectorAll(".clickable-tag"); 
  clickableTags.forEach(tagEl => {
    tagEl.addEventListener("click", () => {
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
  const buttons = document.querySelectorAll("#filters button");
  buttons.forEach(btn => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

// 記事データ（getArticles()で取得済み）を使ってタグ一覧を作る
function extractUniqueTags(articles) {
  const tagCounts = {};

  articles.forEach(article => {
    if (!article["タグ"]) return;
    const tags = article["タグ"].split(",").map(tag => tag.trim());

    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  // 件数の多い順にソートして返す
  return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
}

const selectedTags = new Set();

function renderTagButtons(tagsWithCounts) {
  const container = document.getElementById("tag-buttons");
  container.innerHTML = "";

  tagsWithCounts.forEach(([tag, count]) => {
    const btn = document.createElement("button");
    btn.textContent = `#${tag} (${count})`;
    btn.classList.add("tag-button");
    btn.setAttribute("data-tag", tag); // ← これ追加すると再利用しやすい！

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

  // タグクリアボタン
  document.getElementById("clear-tags").addEventListener("click", () => {
    selectedTags.clear();
    document.querySelectorAll(".tag-button").forEach(btn => btn.classList.remove("active"));
    applyFilters();
  });
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
  const thumbnailTitle = document.querySelector("h2");

  const isMobile = window.innerWidth < 800;

  if (tab === "articles") {
    news.classList.add("active");
    gallery.classList.remove("active");

    if (isMobile) {
      if (thumbnailTitle) thumbnailTitle.style.display = "none";
      if (gallery) gallery.style.display = "none";
    } else {
      // ← ここ追加
      if (thumbnailTitle) thumbnailTitle.style.display = "";
      if (gallery) gallery.style.display = "";
    }
  } else {
    news.classList.remove("active");
    gallery.classList.add("active");

    if (isMobile) {
      if (thumbnailTitle) thumbnailTitle.style.display = "";
      if (gallery) gallery.style.display = "";
    } else {
      // ← ここ追加
      if (thumbnailTitle) thumbnailTitle.style.display = "";
      if (gallery) gallery.style.display = "";
    }
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
  document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
});
