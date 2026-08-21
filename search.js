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

  function normalizeDocPath(href) {
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) return "";
    href = String(href).trim();
    if (href.indexOf("#/") === 0) href = href.slice(2);
    else if (href.charAt(0) === "#") return "";
    var cut = href.search(/[?#]/);
    if (cut !== -1) href = href.slice(0, cut);
    href = href.replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
    if (!href || href === "README") return "README.md";
    if (!/\.md$/i.test(href)) href += ".md";
    return href;
  }

  function pathToHash(filePath) {
    var route = normalizeDocPath(filePath).replace(/\.md$/i, "");
    if (!route || route === "README") return "#/";
    return "#/" + route;
  }

  function parseDates(content) {
    var head = String(content || "").split("\n").slice(0, 12).join("\n");
    return {
      created: (head.match(/创建时间[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})/) || [])[1] || "",
      updated: (head.match(/最新更新[：:]\s*([\d]{4}-[\d]{2}-[\d]{2})/) || [])[1] || "",
    };
  }

  function buildIndex() {
    if (indexed) return Promise.resolve();
    if (indexPromise) return indexPromise;
    var links = document.querySelectorAll(".sidebar-nav a[href]");
    var promises = [];
    var seen = {};
    links.forEach(function (link) {
      if (link.closest(".app-sub-sidebar")) return;
      var filePath = normalizeDocPath(link.getAttribute("href"));
      if (!filePath || seen[filePath]) return;
      seen[filePath] = true;
      var fallbackTitle = (link.textContent || "").replace(/\s+/g, " ").trim();
      promises.push(
        fetch(filePath)
          .then(function (r) {
            if (!r.ok) throw new Error("fetch " + filePath);
            return r.text();
          })
          .then(function (content) {
            var titleMatch = content.match(/^#\s+(.+)$/m);
            var title = titleMatch
              ? titleMatch[1].replace(/[*`]/g, "").trim()
              : fallbackTitle;
            var dates = parseDates(content);
            var tags = parseTags(content);
            searchIndex.push({
              title: title,
              path: filePath,
              content: content,
              contentLower: content.toLowerCase(),
              breadcrumb: filePath.replace(/\.md$/i, "").replace(/\//g, " / "),
              created: dates.created,
              updated: dates.updated,
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
    hash = hash.replace(/\.md$/i, "").replace(/\/$/, "");
    if (!hash || hash === "README") return "README";
    return hash;
  }

  function markActiveResult(container) {
    if (!container) return;
    var hash = currentHashPath();
    container.querySelectorAll(".kb-result-item").forEach(function (el) {
      var p = normalizeDocPath(el.getAttribute("data-path")).replace(/\.md$/i, "") || "README";
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
        window.location.hash = pathToHash(p);
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

  function formatRelativeDate(iso) {
    if (!iso) return { text: "—", title: "", recent: false };
    var parts = String(iso).split("-");
    if (parts.length !== 3) return { text: iso, title: iso, recent: false };
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return { text: iso, title: iso, recent: false };
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((today - d) / 86400000);
    var text = iso;
    if (diff === 0) text = "今天";
    else if (diff === 1) text = "昨天";
    else if (diff > 1 && diff < 14) text = diff + " 天前";
    else if (diff === -1) text = "明天";
    else if (diff < -1 && diff > -14) text = Math.abs(diff) + " 天后";
    return { text: text, title: iso, recent: diff >= 0 && diff < 7 };
  }

  function dateMetaHtml(label, iso) {
    var rel = formatRelativeDate(iso);
    return (
      '<span class="kb-meta-item' +
      (rel.recent ? " is-recent" : "") +
      '" title="' +
      escapeHtml(label + (iso ? " " + iso : "")) +
      '">' +
      CLOCK_ICON +
      "<span>" +
      escapeHtml(label + " " + rel.text) +
      "</span></span>"
    );
  }

  function renderDates(item) {
    return (
      '<div class="kb-result-dates">' +
      dateMetaHtml("创建", item.created) +
      dateMetaHtml("更新", item.updated) +
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
    if (created) html += dateMetaHtml("创建", created);
    if (updated) html += dateMetaHtml("更新", updated);
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
    bindSidebarSplitters(sidebar);
  }

  function bindSidebarSplitters(sidebar) {
    if (!sidebar) return;
    var search = sidebar.querySelector(".kb-search");
    var nav = sidebar.querySelector(".kb-nav-panel");
    if (!search || !nav) return;

    var splitY = sidebar.querySelector(".kb-split-y");
    if (!splitY) {
      splitY = document.createElement("div");
      splitY.className = "kb-split-y";
      splitY.setAttribute("role", "separator");
      splitY.setAttribute("aria-orientation", "horizontal");
      splitY.setAttribute("aria-label", "拖动调整搜索区与目录高度");
      splitY.title = "拖动调整高度，双击复位";
      splitY.tabIndex = 0;
      sidebar.insertBefore(splitY, nav);
    } else if (splitY.nextElementSibling !== nav) {
      sidebar.insertBefore(splitY, nav);
    }

    var splitX = sidebar.querySelector(".kb-split-x");
    if (!splitX) {
      splitX = document.createElement("div");
      splitX.className = "kb-split-x";
      splitX.setAttribute("role", "separator");
      splitX.setAttribute("aria-orientation", "vertical");
      splitX.setAttribute("aria-label", "拖动调整侧栏宽度");
      splitX.title = "拖动调整宽度，双击复位";
      splitX.tabIndex = 0;
      sidebar.appendChild(splitX);
    }

    if (sidebar.dataset.kbSplitBound) return;
    sidebar.dataset.kbSplitBound = "1";

    var MIN_SIDEBAR = 240;
    var MIN_SEARCH = 160;
    var MIN_NAV = 140;

    function maxSidebar() {
      return Math.min(640, Math.floor(window.innerWidth * 0.72));
    }

    function currentWidth() {
      return sidebar.getBoundingClientRect().width || 328;
    }

    function setSidebarWidth(px, persist) {
      px = Math.round(Math.max(MIN_SIDEBAR, Math.min(maxSidebar(), px)));
      document.documentElement.style.setProperty("--sidebar-width", px + "px");
      if (persist !== false) {
        try { localStorage.setItem("kb-sidebar-width", String(px)); } catch (e) {}
      }
    }

    function setSearchHeight(px, persist) {
      var total = sidebar.clientHeight;
      var y = sidebar.querySelector(".kb-split-y");
      var splitH = y ? y.offsetHeight : 8;
      var maxH = total - splitH - MIN_NAV;
      px = Math.round(Math.max(MIN_SEARCH, Math.min(maxH, px)));
      document.documentElement.style.setProperty("--kb-search-height", px + "px");
      if (persist !== false) {
        try { localStorage.setItem("kb-search-height", String(px)); } catch (e) {}
      }
    }

    function preferredWidth() {
      var w = parseInt(localStorage.getItem("kb-sidebar-width"), 10);
      if (w >= MIN_SIDEBAR) return w;
      return 328;
    }

    function preferredSearchHeight() {
      var h = localStorage.getItem("kb-search-height");
      if (h && /^\d+px$/.test(h)) return parseInt(h, 10);
      return null;
    }

    function bindPointer(el, kind, onDelta) {
      el.addEventListener("pointerdown", function (event) {
        if (event.button) return;
        event.preventDefault();
        var start = kind === "x" ? event.clientX : event.clientY;
        var base = kind === "x" ? currentWidth() : search.getBoundingClientRect().height;
        el.classList.add("is-dragging");
        document.body.classList.add(kind === "x" ? "kb-resizing-x" : "kb-resizing-y");
        try { el.setPointerCapture(event.pointerId); } catch (e) {}
        function move(ev) {
          var now = kind === "x" ? ev.clientX : ev.clientY;
          onDelta(base + (now - start));
        }
        function up() {
          el.classList.remove("is-dragging");
          document.body.classList.remove("kb-resizing-x", "kb-resizing-y");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
        }
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
    }

    bindPointer(splitX, "x", setSidebarWidth);
    bindPointer(splitY, "y", setSearchHeight);

    splitX.addEventListener("dblclick", function () {
      document.documentElement.style.setProperty("--sidebar-width", "328px");
      try { localStorage.removeItem("kb-sidebar-width"); } catch (e) {}
    });
    splitY.addEventListener("dblclick", function () {
      document.documentElement.style.setProperty("--kb-search-height", "46%");
      try { localStorage.removeItem("kb-search-height"); } catch (e) {}
    });

    splitX.addEventListener("keydown", function (event) {
      var step = event.shiftKey ? 32 : 16;
      if (event.key === "ArrowLeft") { event.preventDefault(); setSidebarWidth(currentWidth() - step); }
      if (event.key === "ArrowRight") { event.preventDefault(); setSidebarWidth(currentWidth() + step); }
    });
    splitY.addEventListener("keydown", function (event) {
      var step = event.shiftKey ? 32 : 16;
      var h = search.getBoundingClientRect().height;
      if (event.key === "ArrowUp") { event.preventDefault(); setSearchHeight(h - step); }
      if (event.key === "ArrowDown") { event.preventDefault(); setSearchHeight(h + step); }
    });

    window.addEventListener("resize", function () {
      setSidebarWidth(preferredWidth(), false);
      var ph = preferredSearchHeight();
      if (ph != null) setSearchHeight(ph, false);
    });
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
      '<input type="text" class="kb-search-input" placeholder="搜索知识..." autocomplete="off" aria-label="搜索知识" />' +
      '<kbd class="kb-search-kbd">/</kbd>' +
      '<button type="button" class="kb-search-clear" hidden aria-label="清除搜索">×</button>' +
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
    var searchBox = div.querySelector(".kb-search-box");
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
    bindSearchField(searchBox, input, function () {
      savedQuery = "";
      doSearch("");
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
      '<label class="kb-cover-box">' +
      SEARCH_ICON +
      '<input type="text" class="kb-cover-input" placeholder="搜索知识..." autocomplete="off" aria-label="封面搜索" />' +
      '<kbd class="kb-search-kbd">/</kbd>' +
      '<button type="button" class="kb-search-clear" hidden aria-label="清除搜索">×</button>' +
      "</label>" +
      '<div class="kb-cover-modes">' +
      '<button class="kb-cover-mode-btn" type="button" data-mode="title">标题</button>' +
      '<button class="kb-cover-mode-btn active" type="button" data-mode="fulltext">全文</button>' +
      '<button class="kb-cover-mode-btn" type="button" data-mode="fuzzy">模糊</button>' +
      '<button class="kb-cover-mode-btn" type="button" data-mode="exact">精确</button>' +
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
    var coverBox = div.querySelector(".kb-cover-box");
    var modeBtns = div.querySelectorAll(".kb-cover-mode-btn");
    var results = div.querySelector(".kb-cover-results");

    input.addEventListener("input", function () {
      savedQuery = this.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        buildIndex().then(function () { doSearch(savedQuery, results); });
      }, 200);
    });
    bindSearchField(coverBox, input, function () {
      savedQuery = "";
      doSearch("", results);
    });

    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        currentMode = this.getAttribute("data-mode");
        syncModeButtons();
        if (input.value.trim()) doSearch(input.value, results);
      });
    });
  }

  function syncSearchField(box, input) {
    if (!box || !input) return;
    var hasValue = !!input.value;
    box.classList.toggle("is-active", hasValue || document.activeElement === input);
    var clearBtn = box.querySelector(".kb-search-clear");
    if (clearBtn) clearBtn.hidden = !hasValue;
  }

  function bindSearchField(box, input, onClear) {
    if (!box || !input) return;
    input.addEventListener("focus", function () { syncSearchField(box, input); });
    input.addEventListener("blur", function () { syncSearchField(box, input); });
    input.addEventListener("input", function () { syncSearchField(box, input); });
    var clearBtn = box.querySelector(".kb-search-clear");
    if (clearBtn) {
      clearBtn.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      clearBtn.addEventListener("click", function () {
        input.value = "";
        syncSearchField(box, input);
        input.focus();
        if (onClear) onClear();
      });
    }
    syncSearchField(box, input);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  function bindSearchHotkeys() {
    if (document.documentElement.dataset.kbHotkeys) return;
    document.documentElement.dataset.kbHotkeys = "1";
    document.addEventListener("keydown", function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      var sidebarInput = document.querySelector(".kb-search-input");
      var coverInput = document.querySelector(".kb-cover-input");
      var coverVisible = document.body.classList.contains("kb-cover-visible");
      var active = document.activeElement;

      if (event.key === "Escape") {
        if (active === sidebarInput && sidebarInput.value) {
          sidebarInput.value = "";
          savedQuery = "";
          doSearch("");
          syncSearchField(sidebarInput.closest(".kb-search-box"), sidebarInput);
          event.preventDefault();
        } else if (active === coverInput && coverInput.value) {
          coverInput.value = "";
          savedQuery = "";
          doSearch("", document.querySelector(".kb-cover-results"));
          syncSearchField(coverInput.closest(".kb-cover-box"), coverInput);
          event.preventDefault();
        } else if (active === sidebarInput || active === coverInput) {
          active.blur();
        }
        return;
      }

      if (event.key === "/" && !isTypingTarget(active)) {
        event.preventDefault();
        var target = coverVisible && coverInput ? coverInput : sidebarInput;
        if (!coverVisible && document.body.classList.contains("sidebar-collapsed")) {
          var toggle = document.querySelector(".sidebar-collapse-toggle");
          if (toggle) toggle.click();
        }
        if (target) {
          target.focus();
          target.select();
        }
      }
    });
  }

  hook.mounted(function () {
    bindSearchHotkeys();
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
