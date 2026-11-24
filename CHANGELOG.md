# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Favorites bar under the toolbar. Drag folders and files onto it (from a file list or from the desktop) to add them;
  click a folder to go into it (middle-click: new tab) and a file to open it with its app. Groups show as folders on
  the bar with a drop-down list: drop items on a group to put them in it, or hold the drag there to open it and drop at
  an exact place. Items and groups are reordered by dragging. Right-click for rename, move to group, show a file in
  its folder, new group, remove group (its favorites stay) and hiding the bar. The bar and the sidebar Favorites show
  the same list; file favorites are opened from the sidebar too. Show or hide it in Settings → Appearance, with the
  optional "Fav bar" toolbar button or `Set FAVBAR=toggle`.
- "Edit favorites…" in the right-click menu of the favorites bar, its items and groups (and of the sidebar
  Favorites), laid out like a browser's bookmark manager: the favorites bar and its folders on the left, the content
  of the chosen folder on the right. Drag rows to reorder them or onto a folder (left or right) to move them, drag
  folders along the bar, drop files and folders from the desktop, double-click to rename in place (or open a folder),
  right-click for Rename, Move to, Remove; search across all folders; shortcuts are set on each row and refused with
  the reason when taken. Nothing changes until Save. Folders show what is inside them, both under their row on the
  right and under their name on the left; the arrow beside a folder (or the Left and Right keys) hides and shows it.
- Colored favorites folders: right-click a group on the favorites bar, in the sidebar or in "Edit favorites" and pick
  a Folder color (or Default). The color shows on the bar, in its drop-down list, in the sidebar and in "Edit
  favorites", follows the group when it is renamed, and is kept in exported settings.
- Editable labels: right-click a label in the sidebar to rename it, change its color or delete it (it is taken off
  the items that have it, after asking); the + beside the Labels title adds a new one. The sidebar now lists every
  label.
- Sidebar sections (Favorites, Places, Folders, Labels) open and close from their title, and stay so between sessions.

### Changed

- While the favorites bar is shown, the sidebar no longer repeats the Favorites section; hiding the bar brings it back.
- More room around the toolbar buttons, the favorites bar and the items of right-click menus.
- Labels are listed under Folders in the sidebar.

### Development

- Linux: `npm install` checks whether the system blocks the Chromium sandbox for the Electron in `node_modules`
  (Ubuntu 23.10+ with AppArmor, helper not setuid root). Only then that Electron is started with `--no-sandbox`, so
  `npm start`, `npm run dev` and tools that run it directly no longer abort at once. Installed packages and Windows
  and macOS are unchanged.
- Right-click a folder name in the path bar, the folder tree or the Favorites section for a folder menu: Properties,
  add to favorites with a shortcut key, and a custom color for the folder icon and for the background of its row.
  The same color entries are in the context menu of a folder in the file list.
- Favorites can have a shortcut (Ctrl or Alt with a key, or a function key) that opens the folder in the active pane
  from anywhere, also while the folder tree has the focus. Keys already used by a command or another favorite are
  refused. The shortcut is shown next to the favorite.
- Folder colors are shown in the path bar, the folder tree, Favorites and every file view, and are kept when the
  folder is renamed in Opal. They are part of exported settings.

### Previews

- Source code in Quick Look and the viewer pane is shown with syntax highlighting, chosen by file name or extension
  (JavaScript/TypeScript, Python, C/C++, C#, Java, Go, Rust, Ruby, PHP, Kotlin, Swift, Lua, shell, PowerShell, batch,
  SQL, JSON, YAML, TOML/INI, HTML/XML, CSS/SCSS/Less, Makefile, Dockerfile, CMake, Arduino, diff…) or a `#!` line.
  Fenced code blocks in rendered Markdown are colored too. Colors follow the dark and light themes; plain text and
  very large files are shown as before.

### Linux

- The window and the dock now recognise the installed app (matching `desktopName`), so Opal gets its own icon, can be
  pinned to the dock and the window carries the app icon.

## [0.2.0] — 2026-10-23

First public release.

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

[0.2.0]: https://github.com/enprevo/opal/releases/tag/v0.2.0
