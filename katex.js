function kbKatexPlugin(hook) {
  var slots = [];

  function escapeHtml(t) {
    return String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  hook.beforeEach(function (markdown) {
    slots = [];
    var protectedBlocks = [];

    markdown = markdown.replace(/```[\s\S]*?```/g, function (block) {
      protectedBlocks.push(block);
      return "@@FENCE" + (protectedBlocks.length - 1) + "@@";
    });
    markdown = markdown.replace(/`[^`\n]+`/g, function (inline) {
      protectedBlocks.push(inline);
      return "@@FENCE" + (protectedBlocks.length - 1) + "@@";
    });

    function stash(tex, display) {
      var id = slots.length;
      slots.push({ tex: tex.trim(), display: display });
      return display ? "\n\n@@KATEX" + id + "@@\n\n" : "@@KATEX" + id + "@@";
    }

    markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, function (_, tex) {
      return stash(tex, true);
    });
    markdown = markdown.replace(/\$([^$\n]+?)\$/g, function (_, tex) {
      return stash(tex, false);
    });

    return markdown.replace(/@@FENCE(\d+)@@/g, function (_, i) {
      return protectedBlocks[Number(i)];
    });
  });

  hook.afterEach(function (html) {
    function renderSlot(item) {
      if (window.katex) {
        try {
          var math = window.katex.renderToString(item.tex, {
            displayMode: item.display,
            throwOnError: false,
            output: "html",
          });
          return item.display ? '<div class="kb-math">' + math + "</div>" : math;
        } catch (e) {}
      }
      var fallback = escapeHtml(item.tex);
      return item.display
        ? '<pre class="kb-math-fallback">' + fallback + "</pre>"
        : '<code class="kb-math-fallback">' + fallback + "</code>";
    }
    html = html.replace(/<p>\s*@@KATEX(\d+)@@\s*<\/p>/g, function (_, i) {
      var item = slots[Number(i)];
      return item ? renderSlot(item) : _;
    });
    return html.replace(/@@KATEX(\d+)@@/g, function (_, i) {
      var item = slots[Number(i)];
      return item ? renderSlot(item) : _;
    });
  });
}
