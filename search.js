function kbSearchPlugin(hook) {
  var searchIndex = [];
  var fuse = null;
  var indexed = false;
  var indexPromise = null;
  var currentMode = "fulltext";
  var savedQuery = "";
  var debounceTimer = null;

  function buildIndex() {
    if (indexed) return Promise.resolve();
    if (indexPromise) return indexPromise;
    var links = document.querySelectorAll(".sidebar-nav a[href]");
    var promises = [];
    var seen = {};
    links.forEach(function (link) {
      var href = link.getAttribute("href");
      if (!href || href.startsWith("http") || seen[href]) return;
      var filePath;
      if (href.startsWith("#/")) {
        filePath = href.substring(2) + ".md";
      } else if (href.endsWith(".md")) {
        filePath = href;
      } else {
        return;
      }
      seen[href] = true;
      promises.push(
        fetch(filePath)
          .then(function (r) { return r.text(); })
          .then(function (content) {
            var titleMatch = content.match(/^#\s+(.+)$/m);
            var title = titleMatch
              ? titleMatch[1].replace(/[*`]/g, "").trim()
              : link.textContent.trim();
            searchIndex.push({
              title: title,
              path: filePath,
              content: content,
              contentLower: content.toLowerCase(),
              breadcrumb: filePath.replace(/\.md$/, "").replace(/\//g, " / "),
            });
          })
          .catch(function () {})
      );
    });
    indexPromise = Promise.all(promises).then(function () {
      if (window.Fuse) {
        fuse = new Fuse(searchIndex, {
          keys: ["title", "content"],
          includeScore: true,
          threshold: 0.35,
          ignoreLocation: true,
          minMatchCharLength: 1,
        });
      }
      indexed = true;
    });
    return indexPromise;
  }

  function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(new RegExp("(" + safe + ")", "gi"), "<mark>$1</mark>");
  }

  function getSnippet(content, query, maxLen) {
    var idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) {
      var lines = content.split("\n").filter(function (l) {
        return l.trim() && !l.startsWith("#") && !l.startsWith("```");
      });
      return lines.length ? escapeHtml(lines[0].substring(0, maxLen)) : "";
    }
    var start = Math.max(0, idx - 40);
    var end = Math.min(content.length, idx + query.length + 40);
    var snippet =
      (start > 0 ? "..." : "") +
      content.substring(start, end) +
      (end < content.length ? "..." : "");
    return highlight(snippet, query);
  }

  function doSearch(query, container) {
    if (!container) container = document.querySelector(".kb-search-results");
    if (!container) return;
    if (!query.trim()) {
      container.innerHTML = '<div class="kb-search-hint">输入关键词搜索知识</div>';
      return;
    }
    var results = [];
    if (currentMode === "title") {
      var q = query.toLowerCase();
      results = searchIndex
        .filter(function (i) { return i.title.toLowerCase().indexOf(q) !== -1; })
        .map(function (i) { return { item: i, snippet: highlight(i.title, query) }; });
    } else if (currentMode === "fulltext") {
      var qf = query.toLowerCase();
      results = searchIndex
        .filter(function (i) { return i.contentLower.indexOf(qf) !== -1; })
        .map(function (i) { return { item: i, snippet: getSnippet(i.content, query, 100) }; });
    } else if (currentMode === "fuzzy") {
      if (fuse) {
        results = fuse.search(query).slice(0, 20).map(function (r) {
          return { item: r.item, snippet: getSnippet(r.item.content, query, 100) };
        });
      }
    } else if (currentMode === "exact") {
      results = searchIndex
        .filter(function (i) { return i.content.indexOf(query) !== -1; })
        .map(function (i) { return { item: i, snippet: getSnippet(i.content, query, 100) }; });
    }
    if (results.length === 0) {
      container.innerHTML = '<div class="kb-search-hint">没有找到结果</div>';
      return;
    }
    container.innerHTML = results
      .map(function (r) {
        var titleHtml = currentMode === "title" ? r.snippet : escapeHtml(r.item.title);
        var snippetHtml =
          currentMode !== "title"
            ? '<div class="kb-result-snippet">' + r.snippet + "</div>"
            : "";
        return (
          '<div class="kb-result-item" data-path="' + r.item.path + '">' +
          '<div class="kb-result-title">' + titleHtml + "</div>" +
          '<div class="kb-result-path">' + escapeHtml(r.item.breadcrumb) + "</div>" +
          snippetHtml +
          "</div>"
        );
      })
      .join("");
    container.querySelectorAll(".kb-result-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = this.getAttribute("data-path");
        window.location.hash = "#/" + p.replace(/\.md$/, "");
      });
    });
  }

  function renderSearchUI() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar || sidebar.querySelector(".kb-search")) return;
    var div = document.createElement("div");
    div.className = "kb-search";
    div.innerHTML =
      '<input type="text" class="kb-search-input" placeholder="搜索知识..." autocomplete="off" />' +
      '<div class="kb-search-modes">' +
      '<button class="kb-mode-btn" data-mode="title">标题</button>' +
      '<button class="kb-mode-btn active" data-mode="fulltext">全文</button>' +
      '<button class="kb-mode-btn" data-mode="fuzzy">模糊</button>' +
      '<button class="kb-mode-btn" data-mode="exact">精确</button>' +
      "</div>" +
      '<div class="kb-search-results"><div class="kb-search-hint">输入关键词搜索知识</div></div>';
    sidebar.insertBefore(div, sidebar.firstChild);

    var input = div.querySelector(".kb-search-input");
    var modeBtns = div.querySelectorAll(".kb-mode-btn");

    input.value = savedQuery;
    modeBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === currentMode);
    });
    if (savedQuery) doSearch(savedQuery);

    input.addEventListener("input", function () {
      savedQuery = this.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        buildIndex().then(function () { doSearch(savedQuery); });
      }, 200);
    });

    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        currentMode = this.getAttribute("data-mode");
        syncModeButtons();
        if (input.value.trim()) doSearch(input.value);
      });
    });
  }

  function syncModeButtons() {
    document.querySelectorAll(".kb-mode-btn, .kb-cover-mode-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === currentMode);
    });
  }

  function renderCoverSearch() {
    var cover = document.querySelector(".cover.show");
    if (!cover) return;
    var coverMain = cover.querySelector(".cover-main");
    if (!coverMain || cover.querySelector(".kb-cover-search")) return;
    var div = document.createElement("div");
    div.className = "kb-cover-search";
    div.innerHTML =
      '<input type="text" class="kb-cover-input" placeholder="搜索知识..." autocomplete="off" />' +
      '<div class="kb-cover-modes">' +
      '<button class="kb-cover-mode-btn" data-mode="title">标题</button>' +
      '<button class="kb-cover-mode-btn active" data-mode="fulltext">全文</button>' +
      '<button class="kb-cover-mode-btn" data-mode="fuzzy">模糊</button>' +
      '<button class="kb-cover-mode-btn" data-mode="exact">精确</button>' +
      "</div>" +
      '<div class="kb-cover-results"></div>';
    var lastP = null;
    for (var i = coverMain.children.length - 1; i >= 0; i--) {
      if (coverMain.children[i].tagName === "P") {
        lastP = coverMain.children[i];
        break;
      }
    }
    if (lastP) {
      coverMain.insertBefore(div, lastP);
    } else {
      coverMain.appendChild(div);
    }
    syncModeButtons();

    var input = div.querySelector(".kb-cover-input");
    var modeBtns = div.querySelectorAll(".kb-cover-mode-btn");
    var results = div.querySelector(".kb-cover-results");

    input.addEventListener("input", function () {
      savedQuery = this.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        buildIndex().then(function () { doSearch(savedQuery, results); });
      }, 200);
    });

    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        currentMode = this.getAttribute("data-mode");
        syncModeButtons();
        if (input.value.trim()) doSearch(input.value, results);
      });
    });
  }

  hook.doneEach(function () {
    renderSearchUI();
    renderCoverSearch();
    buildIndex();
  });
}
