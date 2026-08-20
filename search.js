function kbSearchPlugin(hook) {
  var searchIndex = [];
  var fuse = null;
  var indexed = false;
  var indexPromise = null;
  var currentMode = "fulltext";
  var savedQuery = "";
  var debounceTimer = null;
  var catalogSortKey = "updated"; // "updated" | "created"
  var catalogOrder = "desc"; // "desc"(新→旧) | "asc"(旧→新)

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
            var dateMatch = content.match(
              /创建时间[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})[\s\S]*?最新更新[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})/
            );
            searchIndex.push({
              title: title,
              path: filePath,
              content: content,
              contentLower: content.toLowerCase(),
              breadcrumb: filePath.replace(/\.md$/, "").replace(/\//g, " / "),
              created: dateMatch ? dateMatch[1] : "",
              updated: dateMatch ? dateMatch[2] : "",
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

  function bindResultClicks(container) {
    container.querySelectorAll(".kb-result-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = this.getAttribute("data-path");
        window.location.hash = "#/" + p.replace(/\.md$/, "");
      });
    });
  }

  function renderCatalog(container) {
    if (!container) return;
    if (!indexed || searchIndex.length === 0) {
      container.innerHTML = '<div class="kb-search-hint">目录加载中…</div>';
      return;
    }
    var items = searchIndex.slice().sort(function (a, b) {
      var va = a[catalogSortKey] || "";
      var vb = b[catalogSortKey] || "";
      // 没有日期的排最后
      if (va !== vb) {
        if (!va) return 1;
        if (!vb) return -1;
        return catalogOrder === "asc" ? (va < vb ? -1 : 1) : (va < vb ? 1 : -1);
      }
      // 日期相同再按标题稳定排序
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    container.innerHTML =
      '<div class="kb-catalog-count">共 ' + items.length + " 篇知识</div>" +
      items
        .map(function (i) {
          var dates =
            '<div class="kb-result-dates">🕐 创建 ' +
            escapeHtml(i.created || "—") +
            " · 更新 " +
            escapeHtml(i.updated || "—") +
            "</div>";
          return (
            '<div class="kb-result-item" data-path="' + i.path + '">' +
            '<div class="kb-result-title">' + escapeHtml(i.title) + "</div>" +
            '<div class="kb-result-path">' + escapeHtml(i.breadcrumb) + "</div>" +
            dates +
            "</div>"
          );
        })
        .join("");
    bindResultClicks(container);
  }

  function refreshCatalogIfIdle() {
    var input = document.querySelector(".kb-search-input");
    var container = document.querySelector(".kb-search-results");
    if (input && container && !input.value.trim()) renderCatalog(container);
  }

  function doSearch(query, container) {
    if (!container) container = document.querySelector(".kb-search-results");
    if (!container) return;
    if (!query.trim()) {
      // 侧栏：空查询时展示可排序目录；封面：保持提示。
      if (container.classList.contains("kb-search-results")) {
        renderCatalog(container);
      } else {
        container.innerHTML = '<div class="kb-search-hint">输入关键词搜索知识</div>';
      }
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
      '<div class="kb-catalog-bar">' +
      '<span class="kb-catalog-label">目录排序</span>' +
      '<button class="kb-sort-btn" data-sortkey="updated">更新时间</button>' +
      '<button class="kb-sort-btn" data-sortkey="created">创建时间</button>' +
      '<button class="kb-sort-order" data-order="desc" title="切换升/降序">新→旧</button>' +
      "</div>" +
      '<div class="kb-search-results"><div class="kb-search-hint">目录加载中…</div></div>';
    sidebar.insertBefore(div, sidebar.firstChild);

    var input = div.querySelector(".kb-search-input");
    var modeBtns = div.querySelectorAll(".kb-mode-btn");
    var sortBtns = div.querySelectorAll(".kb-sort-btn");
    var orderBtn = div.querySelector(".kb-sort-order");

    input.value = savedQuery;
    modeBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === currentMode);
    });
    sortBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-sortkey") === catalogSortKey);
    });
    orderBtn.setAttribute("data-order", catalogOrder);
    orderBtn.textContent = catalogOrder === "desc" ? "新→旧" : "旧→新";

    if (savedQuery) {
      doSearch(savedQuery);
    } else {
      buildIndex().then(refreshCatalogIfIdle);
    }

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

    sortBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        catalogSortKey = this.getAttribute("data-sortkey");
        sortBtns.forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        refreshCatalogIfIdle();
      });
    });

    orderBtn.addEventListener("click", function () {
      catalogOrder = catalogOrder === "desc" ? "asc" : "desc";
      this.setAttribute("data-order", catalogOrder);
      this.textContent = catalogOrder === "desc" ? "新→旧" : "旧→新";
      refreshCatalogIfIdle();
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
    buildIndex().then(refreshCatalogIfIdle);
  });
}
