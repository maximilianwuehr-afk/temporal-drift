# Temporal Drift - Implementation Plan

**Status:** All Phases Complete
**Date:** 2026-02-01
**Deepened:** 2026-02-01

---

## Enhancement Summary

**Research agents used:** 10 parallel agents
- Framework docs researcher (Obsidian API)
- Best practices researcher (Timeline UI patterns)
- TypeScript reviewer
- Architecture strategist
- Performance oracle
- Simplicity reviewer
- Frontend races reviewer
- Obsidian plugin skill
- Similar plugins researcher
- Pattern recognition specialist

### Key Improvements
1. **Simplified MVP** - Cut to 3 core features for Phase 1
2. **Performance-first architecture** - TaskIndexService, TimelineCacheService patterns
3. **Race condition mitigation** - File-level mutex, debounced watchers
4. **Accessibility compliance** - ARIA roles, keyboard navigation, touch targets
5. **Pattern alignment** - SettingsAware, registerEvent(), onLayoutReady patterns from getshitdone

### Critical Decisions
- **Single plugin** (not two) - Task Sidebar as optional view within Temporal Drift
- **Frontmatter-first tasks** - Priority in frontmatter, not folder structure
- **Use MetadataCache** - Never re-parse frontmatter manually

---

## Overview

Single Obsidian plugin with two views:
1. **Temporal Drift View** — Timeline-based daily notes with time as list numeration
2. **Task Sidebar View** — Now/Next/Later view (Phase 4)

---

## Phase 1: Temporal Drift Core (MVP)

### Research Insights

**Simplification recommendation:** Ship 3 features first:
1. Command: "Create daily note" (creates if missing)
2. Calendar modal (7-day week view, click to navigate)
3. Auto-timestamp on Enter in daily notes

**Estimated LOC:** ~500 (vs 1500+ with full architecture)

### 1.1 Project Setup
- [x] Initialize npm package with esbuild config (mirror getshitdone)
- [x] Create manifest.json, versions.json
- [x] Setup TypeScript config
- [x] Create minimal src/ structure

**Research Insights:**
```json
// manifest.json
{
  "id": "temporal-drift",
  "name": "Temporal Drift",
  "description": "Timeline-based daily notes with time as list numeration.",
  "version": "0.1.0",
  "minAppVersion": "1.0.0"
}
```
- Description ends with period, no "Obsidian" or "This plugin"
- ID valid: no "obsidian" prefix, doesn't end with "plugin"

### 1.2 Core Types & Settings

**Research Insights:**
- Use discriminated unions for type safety
- Keep settings flat, avoid deep nesting

```typescript
// types.ts
export interface TemporalDriftSettings {
  dailyNotesFolder: string;
  dateFormat: string;
  tasksFolder: string;
  meetingsFolder: string;
  peopleFolder: string;
  defaultPriority: "now" | "next" | "later";
  themeMode: "light" | "dark" | "system";
  showThankful: boolean;
  showFocus: boolean;
  calendarDays: number;
}

export interface SettingsAware {
  updateSettings(settings: TemporalDriftSettings): void;
}

// Discriminated union for time entries
type TimeEntry =
  | { type: 'task'; time: string; content: string; status: 'open' | 'done' }
  | { type: 'note'; time: string; content: string }
  | { type: 'event'; time: string; title: string; eventId: string };
```

### 1.3 Daily Note Service

**Research Insights:**
- Use `normalizePath()` for cross-platform paths
- Use `vault.process()` for background modifications
- Query via MetadataCache, never re-parse

```typescript
// services/daily-note.ts
import { normalizePath, TFile } from 'obsidian';

class DailyNoteService implements SettingsAware {
  async createDailyNote(date: string): Promise<TFile> {
    const path = normalizePath(`${this.settings.dailyNotesFolder}/${date}.md`);

    // Atomic create-if-not-exists
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      return existing;
    }

    const content = this.getTemplate(date);
    return await this.app.vault.create(path, content);
  }

  async appendEntry(file: TFile, time: string, text: string): Promise<void> {
    // Use vault.process for atomic update
    await this.app.vault.process(file, (content) => {
      return content + `\n${time} ${text}`;
    });
  }
}
```

### 1.4 Temporal Drift View (ItemView)

**Research Insights:**
- Don't store view reference - query when needed
- Use registerDomEvent for DOM listeners
- Cleanup via onClose, not onunload

```typescript
// views/temporal-drift-view.ts
export const VIEW_TYPE_TEMPORAL_DRIFT = "temporal-drift-view";

export class TemporalDriftView extends ItemView {
  private unsubscribers: (() => void)[] = [];

  getViewType(): string { return VIEW_TYPE_TEMPORAL_DRIFT; }
  getDisplayText(): string { return "Temporal Drift"; }
  getIcon(): string { return "clock"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("temporal-drift-view");
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }
}

// Registration in main.ts - don't store reference
this.registerView(VIEW_TYPE_TEMPORAL_DRIFT, (leaf) => {
  return new TemporalDriftView(leaf, this.app, this.settings);
});

// Query when needed
getView(): TemporalDriftView | null {
  const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
  return leaves[0]?.view as TemporalDriftView || null;
}
```

### 1.5 Calendar Strip Component

**Research Insights:**
- Pre-render prev/current/next week for smooth navigation
- Use CSS transform for navigation, not re-render
- ARIA roles for accessibility

```typescript
// views/components/calendar-strip.ts
class CalendarStrip {
  private renderedWeeks: Map<string, HTMLElement> = new Map();

  render(containerEl: HTMLElement, currentDate: Date): void {
    const strip = containerEl.createDiv({
      cls: 'temporal-drift-calendar-strip',
      attr: {
        'role': 'listbox',
        'aria-label': 'Week navigation'
      }
    });

    for (let i = -3; i <= 3; i++) {
      const date = addDays(currentDate, i);
      const isToday = isSameDay(date, new Date());
      const isSelected = isSameDay(date, currentDate);

      const dayBtn = strip.createEl('button', {
        cls: `temporal-drift-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`,
        text: format(date, 'd'),
        attr: {
          'aria-label': format(date, 'EEEE, MMMM d'),
          'aria-selected': isSelected ? 'true' : 'false',
          'role': 'option',
          'tabindex': isSelected ? '0' : '-1'
        }
      });

      // Keyboard navigation
      dayBtn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') this.navigateDay(-1);
        if (e.key === 'ArrowRight') this.navigateDay(1);
      });
    }
  }
}
```

### 1.6 Timeline Renderer

**Research Insights:**
- Parse once, cache structure (TimelineCacheService)
- Use virtual scrolling if >50 entries
- Debounce scroll handlers (16ms for 60fps)

```typescript
// services/timeline-cache.ts
interface ParsedDay {
  path: string;
  mtime: number;
  entries: TimeEntry[];
  thankful?: string;
  focus?: string;
}

class TimelineCacheService implements SettingsAware {
  private cache = new Map<string, ParsedDay>();
  private readonly MAX_CACHED_DAYS = 14;

  async getDay(date: string): Promise<ParsedDay> {
    const cached = this.cache.get(date);
    const file = this.getDailyNoteFile(date);

    if (cached && file && file.stat.mtime === cached.mtime) {
      return cached;  // Cache hit
    }

    const content = file ? await this.app.vault.read(file) : '';
    const parsed = this.parseTimeline(content);

    if (file) {
      parsed.mtime = file.stat.mtime;
      this.cache.set(date, parsed);
      this.evictOldest();
    }

    return parsed;
  }

  private parseTimeline(content: string): ParsedDay {
    const entries: TimeEntry[] = [];
    const lines = content.split('\n');

    // Single-pass parsing - no regex lookbehind (iOS compat)
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\d{2}):(\d{2})\s+(.*)$/);
      if (match) {
        entries.push({
          type: 'note',
          time: `${match[1]}:${match[2]}`,
          content: match[3]
        });
      }
    }

    return { path: '', mtime: 0, entries };
  }
}
```

### 1.7 CSS Theme

**Research Insights:**
- Use Obsidian CSS variables for theme compatibility
- Scope all CSS to `.temporal-drift-*`
- Focus-visible for keyboard users
- 44x44px minimum touch targets

```css
/* styles.css */
.temporal-drift-view {
  --td-accent: var(--interactive-accent);
  background: var(--background-primary);
  color: var(--text-normal);
}

/* Light theme overrides */
.theme-light .temporal-drift-view {
  --td-surface: #f0eeeb;
  --td-accent-warm: #b8864a;
}

/* Dark theme overrides */
.theme-dark .temporal-drift-view {
  --td-surface: #242424;
  --td-accent-warm: #d4a574;
}

/* Time entries - dual typography */
.temporal-drift-time {
  font-family: var(--font-monospace);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
}

.temporal-drift-content {
  font-family: var(--font-text);
  color: var(--text-normal);
}

/* Current time indicator */
.temporal-drift-entry.is-current {
  border-left: 2px solid var(--td-accent-warm);
  padding-left: var(--size-4-2);
}

/* Keyboard focus */
.temporal-drift-entry:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
  background: var(--background-modifier-hover);
}

/* Touch targets */
.temporal-drift-day,
.temporal-drift-checkbox {
  min-width: 44px;
  min-height: 44px;
}

/* Calendar strip */
.temporal-drift-calendar-strip {
  display: flex;
  gap: var(--size-4-1);
  padding: var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
}

.temporal-drift-day.is-today {
  background: var(--td-accent-warm);
  color: var(--text-on-accent);
  border-radius: var(--radius-s);
}

.temporal-drift-day.is-selected {
  outline: 2px solid var(--interactive-accent);
}
```

### 1.8 Commands & Hotkeys

**Research Insights:**
- Use sentence case for command names
- No default hotkeys (let users configure)
- Extract commands to separate file

```typescript
// commands.ts
export function registerCommands(plugin: TemporalDriftPlugin): void {
  // Create daily note
  plugin.addCommand({
    id: 'create-daily-note',
    name: 'Create daily note',  // Sentence case, no prefix
    callback: () => plugin.getDailyNoteService().openToday()
  });

  // Add inline note
  plugin.addCommand({
    id: 'add-inline-note',
    name: 'Add inline note',
    editorCallback: (editor, view) => {
      const time = format(new Date(), 'HH:mm');
      editor.replaceSelection(`${time} `);
    }
  });

  // Open week view
  plugin.addCommand({
    id: 'open-week-view',
    name: 'Open week view',
    callback: () => plugin.activateView()
  });
}
```

### 1.9 Keyboard Navigation

**Research Insights:**
- Use roving tabindex pattern
- Support j/k (vim) and arrows
- ARIA listbox/option roles

```typescript
// services/keyboard-nav.ts
class KeyboardNavigator {
  private items: HTMLElement[] = [];
  private currentIndex = 0;

  constructor(container: HTMLElement) {
    container.setAttribute('role', 'listbox');
    container.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  setItems(items: HTMLElement[]): void {
    this.items = items;
    items.forEach((item, i) => {
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', i === this.currentIndex ? '0' : '-1');
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        this.focusItem(this.currentIndex + 1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        this.focusItem(this.currentIndex - 1);
        break;
      case 'Enter':
        e.preventDefault();
        this.activateItem(this.currentIndex);
        break;
      case 'Escape':
        this.exitEditMode();
        break;
    }
  }

  private focusItem(index: number): void {
    if (index < 0 || index >= this.items.length) return;

    this.items[this.currentIndex]?.setAttribute('tabindex', '-1');
    this.currentIndex = index;
    this.items[index].setAttribute('tabindex', '0');
    this.items[index].focus();
    this.items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
```

### 1.10 Auto-Timestamp on Enter

**Research Insights:**
- Use CodeMirror 6 StateField for editor extensions
- Debounce file watcher to avoid conflicts
- Mark own writes to ignore in watcher

```typescript
// decorators/auto-timestamp.ts
import { Extension, StateField } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

export function createAutoTimestampExtension(settings: TemporalDriftSettings): Extension {
  return keymap.of([{
    key: 'Enter',
    run: (view: EditorView) => {
      // Only in daily notes folder
      const file = view.state.field(editorInfoField)?.file;
      if (!file?.path.startsWith(settings.dailyNotesFolder)) {
        return false;  // Let default handler run
      }

      const cursor = view.state.selection.main.head;
      const line = view.state.doc.lineAt(cursor);

      // Check if current line starts with time
      if (/^\d{2}:\d{2}/.test(line.text)) {
        const time = format(new Date(), 'HH:mm');
        const insert = `\n\n${time} `;

        view.dispatch({
          changes: { from: line.to, insert },
          selection: { anchor: line.to + insert.length }
        });
        return true;
      }

      return false;
    }
  }]);
}

// Register in plugin
this.registerEditorExtension(createAutoTimestampExtension(this.settings));
```

### 1.11 URI Scheme Handlers

**Research Insights:**
- Use registerObsidianProtocolHandler
- Atomic create-if-not-exists pattern

```typescript
// event-handlers.ts
export function registerURIHandlers(plugin: TemporalDriftPlugin): void {
  plugin.registerObsidianProtocolHandler('temporal-drift', async (params) => {
    const { action, date, time, text } = params;

    switch (action) {
      case 'create':
        await plugin.getDailyNoteService().openDailyNote(date || format(new Date(), 'yyyy-MM-dd'));
        break;
      case 'add-note':
        await plugin.getDailyNoteService().addEntry(date, time || format(new Date(), 'HH:mm'), text || '');
        break;
    }
  });
}
```

---

## Phase 2: Event Integration

### Research Insights
- Wrap obsidian-google-calendar plugin API
- Use MetadataCache for People note lookups by email
- Create People notes on-demand with minimal frontmatter

### 2.1 Calendar Plugin Integration
- [ ] Create CalendarService wrapper
- [ ] Fetch events via calendar plugin API
- [ ] Filter participants (exclude rooms, resources, self)

### 2.2 Event Rendering
- [ ] Detect `[[Event ~id]] with [[Person]]` pattern
- [ ] Smart link display (rendered vs raw on cursor)
- [ ] Briefing preview from event note

### 2.3 Participant Linking
- [ ] Search People/ by email frontmatter via MetadataCache
- [ ] Create People note if not found
- [ ] Email → display name humanization

**Code Pattern:**
```typescript
// services/calendar.ts
class CalendarService implements SettingsAware {
  private calendarPlugin: any;

  isAvailable(): boolean {
    this.calendarPlugin = this.app.plugins.getPlugin('obsidian-google-calendar');
    return !!this.calendarPlugin;
  }

  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    if (!this.isAvailable()) return [];
    // Use calendar plugin's API
    return this.calendarPlugin.api.getEvents(date);
  }

  async resolveParticipant(email: string): Promise<TFile | null> {
    // Use MetadataCache for O(1) lookup
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!file.path.startsWith(this.settings.peopleFolder)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.email === email) {
        return file;
      }
    }
    return null;
  }
}
```

---

## Phase 3: Task Inline

### Research Insights
- Build TaskIndexService for O(1) task queries
- Use frontmatter priority (not folder structure)
- Toggle status from anywhere via MetadataCache

### 3.1 Task Detection
- [ ] Parse `- [ ] [[Task name]]` via LinkCache
- [ ] Read frontmatter via MetadataCache (never re-parse)
- [ ] Build TaskIndexService on layout ready

### 3.2 Task Index Service

```typescript
// services/task-index.ts
interface TaskMeta {
  path: string;
  status: 'open' | 'done';
  priority: 'now' | 'next' | 'later';
  due?: string;
}

class TaskIndexService implements SettingsAware {
  private byPriority = new Map<string, Set<string>>();
  private metadata = new Map<string, TaskMeta>();

  async buildIndex(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(this.settings.tasksFolder));

    for (const file of files) {
      await this.indexFile(file);
    }
  }

  private async indexFile(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (!fm) return;

    const meta: TaskMeta = {
      path: file.path,
      status: fm.status || 'open',
      priority: fm.priority || 'now',
      due: fm.due
    };

    this.metadata.set(file.path, meta);

    // Index by priority
    if (!this.byPriority.has(meta.priority)) {
      this.byPriority.set(meta.priority, new Set());
    }
    this.byPriority.get(meta.priority)!.add(file.path);
  }

  getByPriority(priority: string): TaskMeta[] {
    const paths = this.byPriority.get(priority) || new Set();
    return [...paths].map(p => this.metadata.get(p)!).filter(Boolean);
  }

  // Called on vault modify event
  async onFileModify(file: TFile): Promise<void> {
    if (!file.path.startsWith(this.settings.tasksFolder)) return;
    await this.indexFile(file);
  }
}
```

### 3.3 Inline Rendering
- [ ] Custom EditorView decoration for tasks
- [ ] Show: `☐ [[name]] date priority`
- [ ] Clickable checkbox, date picker, priority cycle

### 3.4 Toggle Status (Race Condition Safe)

```typescript
// services/task.ts
const FILE_LOCKS = new Map<string, Promise<void>>();

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const existing = FILE_LOCKS.get(path) ?? Promise.resolve();
  let release: () => void;
  const lock = new Promise<void>(r => release = r);
  FILE_LOCKS.set(path, existing.then(() => lock));

  try {
    await existing;
    return await fn();
  } finally {
    release!();
    if (FILE_LOCKS.get(path) === lock) FILE_LOCKS.delete(path);
  }
}

async toggleTaskStatus(path: string, newStatus: 'open' | 'done'): Promise<void> {
  await withFileLock(path, async () => {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    await this.app.vault.process(file, (content) => {
      return content.replace(
        /^(---\n[\s\S]*?status:\s*)\w+/m,
        `$1${newStatus}`
      );
    });
  });
}
```

---

## Phase 4: Task Sidebar View

### Research Insights
- Same plugin, separate ItemView
- Drag-drop with placeholder insertion
- Use TaskIndexService for queries

### 4.1 Sidebar View
- [ ] Right sidebar panel (ItemView)
- [ ] Now/Next/Later sections
- [ ] Task count badges
- [ ] Delegated/Ideas/Research sections (future)

### 4.2 Drag and Drop

```typescript
// services/drag-drop.ts
class DragDropManager {
  private placeholder: HTMLElement | null = null;

  setupItem(item: HTMLElement, containerId: string): void {
    item.draggable = true;

    item.addEventListener('dragstart', (e) => {
      item.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', item.dataset.taskPath!);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      this.placeholder?.remove();
    });
  }

  setupContainer(container: HTMLElement, onDrop: (path: string, priority: string) => void): void {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      // Show placeholder at drop position
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const path = e.dataTransfer?.getData('text/plain');
      if (path) {
        onDrop(path, container.dataset.priority!);
      }
    });
  }
}
```

---

## Phase 5: Google Tasks Sync

### Research Insights
- Use requestUrl (not fetch) for HTTP
- Version vectors for conflict resolution
- Debounce sync to avoid race conditions

### 5.1 OAuth Setup
- [ ] OAuth 2.0 flow in settings
- [ ] Token storage in plugin settings (encrypted)
- [ ] Refresh token handling

### 5.2 Sync Service
- [ ] Push on create/edit (debounced 150ms)
- [ ] Pull on interval (throttled 30s min)
- [ ] Priority encoding: `[NOW]`, `[NEXT]`, `[LATER]` prefix

### 5.3 Conflict Resolution
```typescript
interface SyncMeta {
  localModified: number;
  remoteEtag?: string;
  lastSynced: number;
}

async reconcile(local: TaskMeta & SyncMeta, remote: RemoteTask): Promise<TaskMeta> {
  // Local wins if modified after last sync
  if (local.localModified > local.lastSynced) {
    await this.pushToRemote(local);
    return local;
  }
  // Remote wins otherwise
  return this.mapRemoteToLocal(remote);
}
```

---

## Phase 6: Polish & Mobile

### Research Insights
- Use Platform API for mobile detection
- FAB for quick capture
- Long-press context menu (avoid swipe conflicts)

### 6.1 Mobile Layout
- [ ] Responsive sidebar (hidden <768px)
- [ ] FAB bottom-right for quick capture
- [ ] 44x44px touch targets
- [ ] Long-press context menu

### 6.2 Templater Integration
```typescript
// main.ts
private exposeTemplaterAPI(): void {
  (this as any).api = {
    createDailyNote: async (tp: any): Promise<string> => {
      const date = tp.file.title || format(new Date(), 'yyyy-MM-dd');
      await this.dailyNoteService.createDailyNote(date);
      return '';  // Return empty, content inserted by service
    }
  };
}
```

---

## File Structure

```
temporal-drift/
├── src/
│   ├── main.ts                 # Plugin entry, lifecycle
│   ├── types.ts                # Interfaces, defaults
│   ├── settings.ts             # Settings tab
│   ├── commands.ts             # Command registration
│   ├── event-handlers.ts       # URI, vault events
│   ├── services/
│   │   ├── daily-note.ts       # Daily note CRUD
│   │   ├── calendar.ts         # Calendar plugin wrapper
│   │   ├── task.ts             # Task operations
│   │   ├── task-index.ts       # O(1) task lookups
│   │   ├── timeline-cache.ts   # Parsed timeline caching
│   │   ├── keyboard-nav.ts     # Roving tabindex
│   │   └── drag-drop.ts        # Drag-drop manager
│   ├── views/
│   │   ├── temporal-drift-view.ts
│   │   ├── task-sidebar-view.ts
│   │   └── components/
│   │       ├── calendar-strip.ts
│   │       └── timeline-renderer.ts
│   ├── decorators/
│   │   ├── auto-timestamp.ts   # Enter key extension
│   │   └── task-decorator.ts   # Inline task rendering
│   └── utils/
│       ├── time.ts             # Time parsing/formatting
│       ├── frontmatter.ts      # Frontmatter utilities
│       ├── deep-merge.ts       # Settings merge
│       └── file-lock.ts        # Mutex for file ops
├── styles.css                  # All styles, scoped
├── manifest.json
├── versions.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── PLAN.md
```

---

## Implementation Order (This Session)

1. Project scaffolding (package.json, esbuild, manifest)
2. Core types & settings (types.ts, DEFAULT_SETTINGS)
3. Main plugin class with SettingsAware pattern
4. Daily note service
5. Temporal Drift view with calendar strip
6. Timeline cache service
7. Timeline renderer
8. CSS theme (light/dark)
9. Commands (create daily note, add inline note)
10. Auto-timestamp extension
11. Keyboard navigation
12. URI scheme handlers

---

## Dependencies

```json
{
  "devDependencies": {
    "@types/node": "^20.10.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.19.0",
    "obsidian": "^1.4.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "tslib": "^2.8.1"
  }
}
```

**External plugin dependency:**
- `obsidian-google-calendar` - For calendar events (Phase 2)

---

## Testing Strategy

1. Build and copy:
   ```bash
   npm run build
   cp main.js manifest.json ~/Workspace/wuehr/.obsidian/plugins/temporal-drift/
   ```
2. Reload Obsidian (Cmd+R)
3. Enable plugin in settings
4. Test commands and view

---

## Performance Instrumentation

```typescript
// utils/perf.ts
const PERF_ENABLED = process.env.NODE_ENV === 'development';

export function measure<T>(label: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn();

  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  if (duration > 50) {
    console.warn(`[TD] ${label}: ${duration.toFixed(1)}ms`);
  }
  return result;
}
```

---

## ESLint Setup

```bash
npm install -D eslint eslint-plugin-obsidianmd
```

```json
// .eslintrc.json
{
  "extends": ["plugin:obsidianmd/recommended"],
  "rules": {
    "obsidianmd/ui/sentence-case": ["warn", {
      "brands": ["Temporal Drift"],
      "acronyms": ["URI", "API"]
    }]
  }
}
```

---

## Key Patterns Summary

| Pattern | From | Application |
|---------|------|-------------|
| SettingsAware | getshitdone | All services implement |
| registerEvent | getshitdone | All vault events |
| onLayoutReady | getshitdone | Build indexes |
| deepMerge | getshitdone | Settings loading |
| File mutex | race condition analysis | Task updates |
| MetadataCache | performance oracle | Never re-parse frontmatter |
| TimelineCacheService | performance oracle | Cache parsed days |
| TaskIndexService | performance oracle | O(1) task queries |
| Roving tabindex | accessibility | Keyboard navigation |
| CSS variables | Obsidian skill | Theme compatibility |
| No innerHTML | Obsidian skill | Security |
| No lookbehind | Obsidian skill | iOS compatibility |
