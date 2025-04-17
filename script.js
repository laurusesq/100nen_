// あなたの Google Apps Script の URL に置き換えてね
const API_URL = "https://raspy-sunset-f70a.100nen-data.workers.dev/?path=articles";

// DOMが読み込まれたら実行
document.addEventListener("DOMContentLoaded", () => {
  fetchArticles();
});

function fetchArticles() {
  fetch(API_URL)
    .then(response => response.json())
    .then(data => {
      displayArticles(data);
    })
    .catch(error => {
      console.error("記事の取得に失敗しました:", error);
    });
}

function displayArticles(articles) {
  const container = document.getElementById("articles");
  if (!container) return;

  container.innerHTML = ""; // 初期化

  articles.forEach(article => {
    const el = document.createElement("div");
    el.className = "article";
    el.innerHTML = `
      <h2>${article.タイトル || "無題"}</h2>
      <p>${article.本文 || ""}</p>
      <small>${article.日付 || ""}</small>
      <hr />
    `;
    container.appendChild(el);
  });
}
