// あなたの Google Apps Script の URL に置き換えてね
const API_URL = "https://script.google.com/macros/s/AKfycbxKrWzMY3LngPbzjCyL7nRSozy7G2ryF9mQ6tMp4qr-CZsp_rJwcxGHN3FKIc_YgBWi/exec?path=articles";

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
