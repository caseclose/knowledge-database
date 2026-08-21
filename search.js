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
  var activeTag = "";

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
            var tags = parseTags(content);
            searchIndex.push({
              title: title,
              path: filePath,
              content: content,
              contentLower: content.toLowerCase(),
              breadcrumb: filePath.replace(/\.md$/, "").replace(/\//g, " / "),
              created: dateMatch ? dateMatch[1] : "",
              updated: dateMatch ? dateMatch[2] : "",
              tags: tags,
              tagsText: tags.join(" "),
            });
          })
          .catch(function () {})
      );
    });
    indexPromise = Promise.all(promises).then(function () {
      if (window.Fuse) {
        fuse = new Fuse(searchIndex, {
          keys: ["title", "content", "tagsText"],
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

  function parseTagsFromMeta(text) {
    var match = text.match(/标签[：:]\s*([^\n]+)/);
    if (!match) return [];
    var raw = match[1].replace(/\s*[|｜].*$/, "").replace(/[`*_]/g, "").trim();
    return raw.split(/[、,，]/).map(function (t) { return t.trim(); }).filter(function (t) {
      return /^[\u4e00-\u9fffA-Za-z0-9_+.-]{1,20}$/.test(t);
    });
  }

  function parseTags(content) {
    var head = content.split("\n").slice(0, 12).join("\n");
    var match = head.match(/^>\s*.*标签[：:]\s*([^\n]+)/m);
    if (!match) return [];
    return parseTagsFromMeta("标签：" + match[1]);
  }

  function escapeHtml(t) {
    return String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    var hash = (window.location.hash || "").replace(/^#\/?/, "");
    hash = hash.split("?")[0].split("&")[0];
    return hash.replace(/\.md$/, "").replace(/\/$/, "");
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
      el.addEventListener("click", function (event) {
        var target = event.target && event.target.nodeType === 1 ? event.target : event.target.parentElement;
        var tagEl = target && target.closest ? target.closest(".kb-tag") : null;
        if (tagEl && tagEl.getAttribute("data-tag")) {
          var onCover = container.classList.contains("kb-cover-results");
          if (onCover) {
            var coverInput = document.querySelector(".kb-cover-input");
            if (!coverInput || !coverInput.value.trim()) return;
          }
          event.preventDefault();
          event.stopPropagation();
          setActiveTag(tagEl.getAttribute("data-tag"));
          return;
        }
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

  function renderTags(item) {
    if (!item.tags || !item.tags.length) return "";
    return (
      '<div class="kb-result-tags">' +
      item.tags
        .map(function (tag) {
          return (
            '<span class="kb-tag" data-tag="' +
            escapeHtml(tag) +
            '">' +
            escapeHtml(tag) +
            "</span>"
          );
        })
        .join("") +
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
      escapeHtml(item.path) +
      '">' +
      '<div class="kb-result-title">' +
      titleHtml +
      "</div>" +
      renderBreadcrumb(item.path) +
      renderTags(item) +
      (extraHtml || "") +
      "</button>"
    );
  }

  function applyTagFilter(items) {
    if (!activeTag) return items;
    return items.filter(function (item) {
      return item.tags && item.tags.indexOf(activeTag) !== -1;
    });
  }

  function collectTags() {
    var counts = {};
    searchIndex.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .sort()
      .map(function (name) {
        return { name: name, count: counts[name] };
      });
  }

  function setActiveTag(tag) {
    activeTag = tag === activeTag ? "" : tag || "";
    renderTagBar();
    var input = document.querySelector(".kb-search-input");
    if (input && input.value.trim()) doSearch(input.value);
    else refreshCatalogIfIdle();
    var coverInput = document.querySelector(".kb-cover-input");
    var coverResults = document.querySelector(".kb-cover-results");
    if (coverInput && coverResults && coverInput.value.trim()) {
      doSearch(coverInput.value, coverResults);
    }
  }

  function renderTagBar() {
    var bar = document.querySelector(".kb-tag-bar");
    if (!bar) return;
    var tags = collectTags();
    if (!tags.length) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    bar.innerHTML =
      '<button type="button" class="kb-tag-filter' +
      (!activeTag ? " is-active" : "") +
      '" data-tag="">全部</button>' +
      tags
        .map(function (tag) {
          return (
            '<button type="button" class="kb-tag-filter' +
            (activeTag === tag.name ? " is-active" : "") +
            '" data-tag="' +
            escapeHtml(tag.name) +
            '">' +
            escapeHtml(tag.name) +
            '<span class="kb-tag-count">' +
            tag.count +
            "</span></button>"
          );
        })
        .join("");
    bar.querySelectorAll(".kb-tag-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActiveTag(this.getAttribute("data-tag") || "");
      });
    });
  }

  function enhanceArticleMeta() {
    var section = document.querySelector(".markdown-section");
    if (!section) return;
    var quote = section.querySelector("blockquote");
    if (!quote || quote.dataset.kbMetaDone) return;
    var text = (quote.textContent || "").replace(/\s+/g, " ").trim();
    if (text.indexOf("创建时间") === -1 && text.indexOf("标签") === -1) return;
    var created = (text.match(/创建时间[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})/) || [])[1];
    var updated = (text.match(/最新更新[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})/) || [])[1];
    var tags = parseTagsFromMeta(text);
    quote.dataset.kbMetaDone = "1";
    var html = '<div class="kb-article-meta">';
    if (created) {
      html +=
        '<span class="kb-meta-item" title="创建时间">' +
        CLOCK_ICON +
        "<span>创建 " +
        escapeHtml(created) +
        "</span></span>";
    }
    if (updated) {
      html +=
        '<span class="kb-meta-item" title="更新时间">' +
        CLOCK_ICON +
        "<span>更新 " +
        escapeHtml(updated) +
        "</span></span>";
    }
    tags.forEach(function (tag) {
      html +=
        '<button type="button" class="kb-tag" data-tag="' +
        escapeHtml(tag) +
        '">' +
        escapeHtml(tag) +
        "</button>";
    });
    html += "</div>";
    quote.outerHTML = html;
    var meta = section.querySelector(".kb-article-meta");
    if (meta) {
      meta.querySelectorAll(".kb-tag").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setActiveTag(this.getAttribute("data-tag") || "");
        });
      });
    }
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
    var items = applyTagFilter(searchIndex.slice()).sort(function (a, b) {
      var va = a[catalogSortKey] || "";
      var vb = b[catalogSortKey] || "";
      if (va !== vb) {
        if (!va) return 1;
        if (!vb) return -1;
        return catalogOrder === "asc" ? (va < vb ? -1 : 1) : (va < vb ? 1 : -1);
      }
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    if (!items.length) {
      container.innerHTML =
        '<div class="kb-search-hint">' +
        (activeTag ? "这个标签下没有知识" : "暂无知识") +
        "</div>";
      return;
    }
    container.innerHTML =
      '<div class="kb-catalog-count">' +
      (activeTag ? escapeHtml(activeTag) + " · " : "") +
      "共 <strong>" +
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
    if (input && container && !input.value.trim()) {
      setSearchingState(false);
      renderCatalog(container);
    }
  }

  function doSearch(query, container) {
    if (!container) container = document.querySelector(".kb-search-results");
    if (!container) return;
    var isSidebar = container.classList.contains("kb-search-results");
    if (!query.trim()) {
      if (isSidebar) setSearchingState(false);
      if (isSidebar) {
        renderCatalog(container);
      } else {
        container.innerHTML = '<div class="kb-search-hint">输入关键词搜索知识</div>';
      }
      return;
    }
    if (isSidebar) setSearchingState(true);
    var results = [];
    if (currentMode === "title") {
      var q = query.toLowerCase();
      results = searchIndex
        .filter(function (i) {
          return i.title.toLowerCase().indexOf(q) !== -1 ||
            (i.tagsText && i.tagsText.toLowerCase().indexOf(q) !== -1);
        })
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
    results = results.filter(function (r) {
      return !activeTag || (r.item.tags && r.item.tags.indexOf(activeTag) !== -1);
    });
    if (results.length === 0) {
      container.innerHTML = '<div class="kb-search-hint">没有找到结果</div>';
      return;
    }
    container.innerHTML =
      '<div class="kb-catalog-count">' +
      (activeTag ? escapeHtml(activeTag) + " · " : "") +
      "找到 <strong>" +
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
      '<a class="kb-search-brand" href="#/" title="回到首页">' +
      '<img src="favicon.svg" class="kb-brand-logo" width="22" height="22" alt="" />' +
      '<span class="kb-brand-name">knowledge-database</span>' +
      "</a>" +
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
      '<div class="kb-tag-bar" hidden></div>' +
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
      buildIndex().then(function () {
        renderTagBar();
        refreshCatalogIfIdle();
      });
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

  hook.mounted(function () {
    window.addEventListener("hashchange", function () {
      markActiveResult(document.querySelector(".kb-search-results"));
    });
  });

  hook.doneEach(function () {
    renderSearchUI();
    wrapNavPanel();
    renderCoverSearch();
    enhanceArticleMeta();
    buildIndex().then(function () {
      renderTagBar();
      refreshCatalogIfIdle();
    });
    markActiveResult(document.querySelector(".kb-search-results"));
  });
}
