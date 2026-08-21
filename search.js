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

  var CLOCK_ICON =
    '<svg class="kb-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
  var SEARCH_ICON =
    '<svg class="kb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

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

  function currentHashPath() {
    return (window.location.hash || "").replace(/^#\/?/, "").replace(/\.md$/, "");
  }

  function markActiveResult(container) {
    if (!container) return;
    var hash = currentHashPath();
    container.querySelectorAll(".kb-result-item").forEach(function (el) {
      var p = (el.getAttribute("data-path") || "").replace(/\.md$/, "");
      el.classList.toggle("is-active", p === hash);
    });
  }

  function bindResultClicks(container) {
    container.querySelectorAll(".kb-result-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = this.getAttribute("data-path");
        window.location.hash = "#/" + p.replace(/\.md$/, "");
      });
    });
    markActiveResult(container);
  }

  function renderBreadcrumb(filePath) {
    var parts = filePath.replace(/\.md$/, "").split("/").filter(Boolean);
    if (parts.length > 1) parts = parts.slice(0, -1);
    if (!parts.length) return "";
    return (
      '<div class="kb-result-path">' +
      parts
        .map(function (part) {
          return '<span class="kb-crumb">' + escapeHtml(part) + "</span>";
        })
        .join('<span class="kb-crumb-sep" aria-hidden="true">/</span>') +
      "</div>"
    );
  }

  function renderDates(item) {
    return (
      '<div class="kb-result-dates">' +
      '<span class="kb-meta-item" title="创建时间">' +
      CLOCK_ICON +
      "<span>创建 " +
      escapeHtml(item.created || "—") +
      "</span></span>" +
      '<span class="kb-meta-item" title="更新时间">' +
      CLOCK_ICON +
      "<span>更新 " +
      escapeHtml(item.updated || "—") +
      "</span></span>" +
      "</div>"
    );
  }

  function renderResultCard(item, titleHtml, extraHtml) {
    return (
      '<button type="button" class="kb-result-item" data-path="' +
      item.path +
      '">' +
      '<div class="kb-result-title">' +
      titleHtml +
      "</div>" +
      renderBreadcrumb(item.path) +
      (extraHtml || "") +
      "</button>"
    );
  }

  function setSearchingState(isSearching) {
    var root = document.querySelector(".kb-search");
    if (root) root.classList.toggle("is-searching", isSearching);
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
      if (va !== vb) {
        if (!va) return 1;
        if (!vb) return -1;
        return catalogOrder === "asc" ? (va < vb ? -1 : 1) : (va < vb ? 1 : -1);
      }
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    container.innerHTML =
      '<div class="kb-catalog-count">共 <strong>' +
      items.length +
      "</strong> 篇知识</div>" +
      items
        .map(function (i) {
          return renderResultCard(i, escapeHtml(i.title), renderDates(i));
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
      setSearchingState(false);
      if (container.classList.contains("kb-search-results")) {
        renderCatalog(container);
      } else {
        container.innerHTML = '<div class="kb-search-hint">输入关键词搜索知识</div>';
      }
      return;
    }
    setSearchingState(true);
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
    container.innerHTML =
      '<div class="kb-catalog-count">找到 <strong>' +
      results.length +
      "</strong> 条结果</div>" +
      results
        .map(function (r) {
          var titleHtml = currentMode === "title" ? r.snippet : escapeHtml(r.item.title);
          var snippetHtml =
            currentMode !== "title"
              ? '<div class="kb-result-snippet">' + r.snippet + "</div>"
              : "";
          return renderResultCard(r.item, titleHtml, snippetHtml);
        })
        .join("");
    bindResultClicks(container);
  }

  function wrapNavPanel() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    var nav = sidebar.querySelector(".sidebar-nav");
    var tools = sidebar.querySelector(".sidebar-tools");
    if (!nav) return;
    var panel = sidebar.querySelector(".kb-nav-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "kb-nav-panel";
      var header = document.createElement("div");
      header.className = "kb-nav-header";
      header.innerHTML = '<span class="kb-nav-title">目录</span>';
      panel.appendChild(header);
      sidebar.appendChild(panel);
    }
    var header = panel.querySelector(".kb-nav-header");
    if (tools && header && tools.parentNode !== header) header.appendChild(tools);
    if (nav.parentNode !== panel) panel.appendChild(nav);
  }

  function renderSearchUI() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar || sidebar.querySelector(".kb-search")) return;
    var div = document.createElement("div");
    div.className = "kb-search";
    div.innerHTML =
      '<div class="kb-search-brand">' +
      '<img src="favicon.svg" class="kb-brand-logo" width="22" height="22" alt="" />' +
      '<span class="kb-brand-name">knowledge-database</span>' +
      "</div>" +
      '<label class="kb-search-box">' +
      SEARCH_ICON +
      '<input type="text" class="kb-search-input" placeholder="搜索知识..." autocomplete="off" />' +
      "</label>" +
      '<div class="kb-search-toolbar">' +
      '<div class="kb-seg kb-search-modes" role="group" aria-label="搜索范围">' +
      '<button class="kb-mode-btn" type="button" data-mode="title">标题</button>' +
      '<button class="kb-mode-btn active" type="button" data-mode="fulltext">全文</button>' +
      '<button class="kb-mode-btn" type="button" data-mode="fuzzy">模糊</button>' +
      '<button class="kb-mode-btn" type="button" data-mode="exact">精确</button>' +
      "</div>" +
      '<div class="kb-seg kb-catalog-bar" role="group" aria-label="目录排序">' +
      '<button class="kb-sort-btn" type="button" data-sortkey="updated">更新</button>' +
      '<button class="kb-sort-btn" type="button" data-sortkey="created">创建</button>' +
      '<button class="kb-sort-order" type="button" data-order="desc" title="切换升/降序">新→旧</button>' +
      "</div>" +
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
    wrapNavPanel();
    renderCoverSearch();
    buildIndex().then(refreshCatalogIfIdle);
    markActiveResult(document.querySelector(".kb-search-results"));
  });
}
