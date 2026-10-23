# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-10-23

First public release: everything below, plus:

### Favorites

- Favorites are a tree: nested groups, separators, folders and files.
- Right-click a favorite or a group to edit it, rename it, give it a text or background colour, an icon or an emoji,
  move it, or add groups and separators.
- **Shortcut keys**: assign a key to a favorite (a single letter such as <kbd>P</kbd>, or a combination) and press it in
  the file list to go there. Keys are shown next to the favorites.
- **Organize favorites**: a manager to reorder by drag and drop (also into groups), edit names, paths, keys, icons and
  colours, sort groups, and choose where each favorite opens (active pane, other pane, new tab). Cancel discards.
- Drag favorites in the sidebar to reorder them; drop folders on the Favorites title to add them.

### Find as you type

- Typing in a file list opens a search bar: the matching part of names is highlighted, <kbd>↑</kbd>/<kbd>↓</kbd> go
  to the next match, <kbd>Enter</kbd> opens it. <kbd>Tab</kbd> switches between Find, Filter (show only matches) and
  Subfolders (search the whole branch); <kbd>Esc</kbd> restores the view.
- Type <kbd>/</kbd> to jump to a favorite (by name, group or path), a recent folder or any path.

### Previews

- Source code is shown with syntax colours in Quick Look and in the viewer pane (40 languages), and code blocks in
  Markdown files are coloured too.

## [0.2.0] — 2026-10-23

Internal preview.

### File management

- Dual-pane file manager with tabs (undo close, duplicate, open in the other pane), folder tree, breadcrumbs,
  multiple windows, Navigation Lock, Flat View and folders that expand in place in the Details view
  (<kbd>→</kbd>/<kbd>←</kbd>, <kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd>); copying nested items asks whether to
  recreate their folders.
- Safe copy/move engine with progress, cancel, conflict policies and temp-file writes; undo for rename, move, copy
  and create.
- Advanced batch rename (wildcards, regex, numbering, case, date macros, presets), Find, Synchronize, Duplicate
  finder, Split/Join, Properties with checksums, viewer pane.
- A command line (`>`) with a small command language, used by hotkeys and toolbar buttons.
- Favorites with names and collapsible groups; mouse back/forward buttons.

### Views

- Quick Look on <kbd>Space</kbd>: images, video, audio, PDF, rendered Markdown, code, folder sizes, archive
  contents; arrow keys flip through files.
- Column view with a preview column; Details, List, Icons and Thumbnails views.
- Sorting and grouping (kind, type, extension, date, size, name, label) with collapsible groups; columns for dates,
  location, labels, image dimensions and item counts; drag to reorder, autosize; remembered per folder.
- Colour labels with a column, sorting, grouping and a sidebar section.
- Helper cards beside buttons, menu items, columns and files that never cover what you point at.

### Search by meaning

- Two local multilingual models: one finds candidate passages by meaning, a cross-encoder re-reads them to rank
  precisely; combined with BM25 keyword search that understands Italian and English word forms. On the included
  benchmark (Italian/English questions mixed into ~450 unrelated real files) the right document comes first 97% of
  the time, and questions without an answer return almost nothing.
- Indexing runs in a separate process (the window never freezes), newest files first; documents only by default
  (PDF, Office, OpenDocument, RTF, EPUB, e-mail, HTML, text, Markdown), code optional; duplicates indexed once.
- Results while typing, highlighted passages, PDF page numbers, type/date/folder filters, relevance, preview panel,
  keyboard navigation, progress with time estimate.

### Make it yours

- Light/dark/system theme, accent colour, density, interface font, stripes, grid lines, date formats, toolbar
  editor, key recorder, two keymaps (standard and Commander-style), layout presets, startup folders, first-run
  setup assistant.
- Every setting lives in one file and can be exported and imported, also between Windows, macOS and Linux (key
  bindings are saved as changes to the platform defaults). Automatic backup; an unreadable settings file is set aside
  instead of being replaced.

### Platforms

- Windows x64/ARM64, macOS Apple Silicon/Intel, Linux x64/ARM64 (AppImage, deb, rpm), built natively on each.
- macOS shortcuts (⌘⌫, ⌘↑/↓, ⌘[ ], ⌘⇧., ⌘⇧G); shortcuts work on every keyboard layout, including
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+digit and Option/AltGr combinations; Ubuntu AppImages start under the AppArmor
  user-namespace restriction; "Open terminal here" finds the terminal of each desktop.

[0.3.0]: https://github.com/enprevo/opal/releases/tag/v0.3.0
