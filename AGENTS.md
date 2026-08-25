# AGENTS.md

## Cursor Cloud specific instructions

This repository is a **static docsify documentation site** (a personal knowledge base, mostly written in Chinese Markdown). There is no build step, no package manager, no automated tests, and no linter.

- Content lives as `.md` files organized by domain directories (`linux/`, `agent/`, `data-pipeline/`, etc.). `index.html`, `_sidebar.md`, `_coverpage.md`, `vue.css`, and `search.js` drive the docsify site.
- Runtime dependencies (docsify, mermaid, fuse.js, docsify plugins) are loaded from the `cdn.jsdelivr.net` CDN at page load, not installed locally. Full rendering/search therefore requires outbound network access to that CDN.
- **Run the site (dev preview):** `bash run_local.sh [port]` (defaults to port 3000). This just runs `python3 -m http.server`, so serve from the repo root. Then open `http://localhost:3000/`.
- Rendering happens client-side, so `curl` of `index.html` returns the raw shell, not rendered content — verify rendering/search in a browser.
- There is nothing to "install" and no lint/test/build commands. Before writing or modifying any knowledge file, read `README.md` first (it defines mandatory directory, naming, and formatting rules).

## Auto-merge to main

This is a personal knowledge base. After you finish changes and verification, **mark the PR ready and merge it into `main` immediately**. Do not wait for the user to say "merge".

- Use a **merge commit** (not squash/rebase unless the user asks).
- Delete the feature branch after merge.
- Exceptions: the user explicitly says not to merge yet, wants a draft only, or the PR has unresolvable conflicts.
- GitHub Action `Auto-merge to main` is a fallback: PRs targeting `main` are marked ready and merged automatically. If you already merged, you do not need to wait for the Action.
