[]()# Temporal Drift System Spec

**Status:** Draft v3
**Date:** 2026-02-01
**Author:** Samwise + Maxi
**Design Language:** Temporal Drift

---

## Overview

A daily note system with two Obsidian plugins:
1. **Temporal Drift** — Timeline-based daily notes with time as list numeration
2. **Task Sidebar** — Now/Next/Later view querying task notes

The daily note is structured markdown. Plugins augment the experience without replacing core Obsidian functionality.

---

## Visual Design

**Terminal meets Dieter Rams meets Anthropic.**

### Principles
| Principle | Implementation |
|-----------|----------------|
| Dual typography | Monospace semi-bold for time + titles, sans-serif for content |
| Single font size | One size throughout — no switching |
| Information density | More info visible than Notion, less than raw terminal |
| Muted palette | Warm grays, soft amber, clay accents — no dark grey for text |
| No chrome | Minimal decoration, content fills space |
| Keyboard-first | Every action reachable without mouse |
| Functional animation | Motion only when it communicates state (< 200ms) |
| Light mode default | Light is default, dark available |

### Typography

| Element       | Font       | Weight          | Purpose                |
| ------------- | ---------- | --------------- | ---------------------- |
| Time stamps   | Monospace  | Semi-bold (600) | Emphasis, scannable    |
| Event titles  | Monospace  | Semi-bold (600) | Emphasis, linked notes |
| Content/notes | Sans-serif | Regular (400)   | Readable body text     |
| Tags/badges   | Monospace  | Regular (400)   | Consistent with time   |

### Color Palette
```
Background:     #1a1a1a (dark) / #faf9f7 (light)
Surface:        #242424 (dark) / #f0eeeb (light)
Text primary:   #e5e5e5 (dark) / #1a1a1a (light)
Text muted:     #888888 (dark) / #666666 (light)
Accent amber:   #d4a574 (dark) / #b8864a (light)
Accent clay:    #c4846c (dark) / #a66b55 (light)
Urgent/error:   #d4574a (only bright color)
```

**Note:** No dark grey for note content. Use primary text color for all content.

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  ← Wed 29 | Thu 30 | Fri 31 | [SAT 1] | Sun 2 | Mon 3 →    │  ← Calendar strip
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  THANKFUL FOR                                               │
│  A quiet morning to think clearly                           │
│                                                             │
│  FOCUS                                                      │
│  Ship auth flow, prep Nick 1:1                              │
│                                                             │
│  ──────────────────────────────────────────────────────     │
│                                                             │
│  09:00  Standup                           ← monospace bold  │
│         Sprint priorities discussed       ← sans-serif      │
│         [[Anna]] raised blocker                             │
│                                                             │
│  10:17  Called Sophie                                  ◀──  │
│         Checking with legal                                 │
│         ☐ [[Send Sophie terms]]  Feb 3  now                 │
│                                                             │
│  13:00  [[Nick 1:1 ~abc123]] with [[Nick Stocks]]   ← event │
│         ┄ Last discussed board prep...                      │
│                                                             │
│         ▼ scroll to previous days ▼                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Link Rendering

### Smart Link Display

Links render as clickable text by default. When cursor is adjacent, reveal raw markdown:

| State         | Display                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| Normal        | `Nick 1:1` (styled as link)                                                    |
| Cursor nearby | `[[Nick 1:1 ~20940194801298401948ddkfnlkmw]]` (raw, including google event id) |

This allows easy editing while keeping the view clean.

### Event Links

**Events ALWAYS link to an event note.** The event note contains the calendar `event_id` which is required for syncing.

```markdown
13:00 [[Nick 1:1 ~20940194801298401948ddkfnlkmw]]
```

The linked note `Meetings/Nick 1:1 ~20940194801298401948ddkfnlkmw.md` contains:
```yaml
---
event_id: 20940194801298401948ddkfnlkmw   # Required for sync
date: 2026-02-01
time: "13:00"
participants:
  - "[[Nick Stocks]]"
---
```

**Why always linked:** The event_id in the note is the source of truth for calendar sync. Without it, we can't update or reference the Google Calendar event.

---

## Calendar Integration

### Source: Google Calendar Plugin

Use **obsidian-google-calendar** plugin for calendar sync.

**Event flow:**
```
Google Calendar event
        │
        ▼
obsidian-google-calendar (plugin)
        │
        ▼
Creates: Meetings/{Title} ~ {date}.md
        │
        ▼
Temporal Drift plugin reads & renders in timeline
```

### Participant Linking

1. Plugin writes `participants:` from event attendees (emails)
2. Post-processor matches emails to People notes (via frontmatter `email:` field)
3. Converts email → `[[Person Name]]` wikilink

---

## Daily Note Structure

### Format

```markdown
# 2026-02-01

## Thankful for
A quiet morning to think clearly

## Focus
Ship auth flow, prep Nick 1:1

09:00 [[Standup]] with [[Anna]], [[Tobias]]
      Sprint priorities discussed
      [[Anna]] raised blocker on auth

09:47 Quick thought
      Maybe we should revisit pricing model

10:17 [[Called Sophie ~20ß205952ß03js]] with [[Sophia Kremer]]
      Checking with legal on renewal
      She needs answer by Friday
      - [ ] [[Send Sophie terms]]
      - [ ] [[Follow up on discount]]

10:41 - [ ] [[Research competitor pricing]]

13:00 [[Nick 1:1 ~OWKPAOKDSPLKD]] with [[Nicholas Stocks (Nick)|Nick Stocks]]
      Discussed Q1 targets
      He wants the deck by Thursday

15:30 [[Deep work]]
      Finally fixed the auth bug
      Took longer than expected
```

### Sections

| Section | Position | Purpose |
|---------|----------|---------|
| Thankful for | Top | Daily gratitude |
| Focus | Below thankful | Day's priorities |
| Timeline | Main body | Time-numbered entries (scrollable) |

**Note:** No separate Inbox section. Unscheduled items live in the timeline or as tasks in the sidebar.

### Time as List Numeration

The time (`HH:mm`) functions as a custom list bullet:
- `09:00` is the numeration (like `1.` or `-`)
- Content follows on the same line or indented below
- Indentation works like standard lists
- New line at cursor position → auto-inserts current time

---

## Temporal Drift Plugin

### Core Behavior

**Display:**
- Calendar strip at top with week view, current day highlighted
- Scrollable timeline showing today + previous days
- Time = left margin numeration (monospace semi-bold)
- Content = main column (sans-serif)
- Current time block has subtle left border accent

**Interaction:**
- Type in empty space → auto-inserts current time, expands
- Enter at end of entry → new line with current time
- Indent/outdent works normally (Tab/Shift+Tab)
- Events show briefing preview (collapsed, one line)
- Tasks show due date + priority as inline tags
- Scroll down to see previous days

### Daily Note Creation

**Plugin command:** `Temporal Drift: Create daily note`

Creates a daily note with proper structure. Can be triggered by:
- Plugin command palette
- Templater hook
- URI scheme: `obsidian://temporal-drift/create?date=2026-02-04`
- OpenClaw (via command or file write)

**On create:**
1. Check if note exists → if yes, open it
2. Create `Daily notes/YYYY-MM-DD.md` with template
3. Pull events from Google Calendar for that date
4. Insert event links at correct times
5. Open note in Temporal Drift

**Template applied:**
```markdown
# {{date}}

## Thankful for


## Focus


{{events}}
```

Where `{{events}}` expands to:
```markdown
09:00 [[Standup ~IJALKFJLKSAJF]]

13:00 [[Nick 1:1 ~LÖMÖLMDLWMLWFM0023]]
```

**Templater integration:**

In Templater settings, set folder template for `Daily notes/`:
```javascript

```

This ensures every daily note created (manually or via Templater) uses the plugin's creation flow.

### Auto-timestamp

When pressing Enter at the end of a time block:
1. Insert blank line
2. Insert current time `HH:mm`
3. Place cursor after time

### Keyboard Navigation

Move between time entries without mouse:

| Key        | Action                      |
| ---------- | --------------------------- |
| `j` or `↓` | Move to next time entry     |
| `k` or `↑` | Move to previous time entry |
| `Enter`    | Focus/edit current entry    |
| `Escape`   | Exit edit mode              |

Vim-style navigation for power users, arrow keys for everyone else.

### Actions / Commands

| Command                                | Shortcut           | What it does                                                           |
| -------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `Temporal Drift: Create daily note`    | —                  | Creates daily note with template + events                              |
| `Temporal Drift: Add task`             | `Ctrl+Shift+Enter` | Quick add task (prompts for title), IF on task already, completes task |
| `Temporal Drift: Add task at time`     | —                  | Prompts for time, creates task at that position                        |
| `Temporal Drift: Add task to meeting`  | —                  | Prompts for meeting, links task to that event                          |
| `Temporal Drift: Add note to meeting`  | —                  | Adds indented line below a meeting                                     |
| `Temporal Drift: Add inline note`      | `⌘+Shift+N`        | Adds timestamped note at current time                                  |
| `Temporal Drift: Add idea`             | —                  | Quick capture idea                                                     |
| `Temporal Drift: Add research`         | —                  | Create research note                                                   |
| `Temporal Drift: Add delegated for`    | —                  | Create delegated item (prompts for person)                             |
| `Temporal Drift: Promote idea to task` | —                  | Converts idea to task, moves to Tasks/                                 |

**URI schemes:**
```
obsidian://temporal-drift/create?date=2026-02-04
obsidian://temporal-drift/add-task?date=2026-02-04&time=14:00&title=...
obsidian://temporal-drift/add-task?meeting=Nick%201:1&title=...
obsidian://temporal-drift/add-meeting?date=2026-02-04&time=14:00&title=...
obsidian://temporal-drift/add-note?date=2026-02-04&time=14:00&text=...
```

### Add Note to Meeting

**Command:** `Temporal Drift: Add note to meeting`

Adds an indented line below an existing meeting in the timeline.

1. Prompts for which meeting (or uses currently selected)
2. Adds indented line below the meeting entry
3. Places cursor ready to type

**Before:**
```markdown
13:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]
      ┄ Briefing preview...
```

**After:**
```markdown
13:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]
      ┄ Briefing preview...
      Quick note from the meeting ← cursor here
```

For capturing thoughts during/after a meeting without opening the meeting note.

### Add Inline Note

**Command:** `Temporal Drift: Add inline note`
**Shortcut:** `⌘ + Shift + N`

Adds a timestamped thought/note directly in the timeline (no linked file).

1. Opens daily note (creates if needed)
2. Inserts current time
3. Places cursor ready to type

**Result:**
```markdown
14:52 ▌
```

For quick thoughts that don't need their own note.

### Quick Capture Shortcut

**Global hotkey:** `⌘ + Shift + N`

From anywhere:
1. Opens/focuses daily note
2. Inserts current time at end of timeline
3. Places cursor ready to type

**In daily view:** `Ctrl + Enter`
- Inserts `HH:mm ▌` at cursor position
- Immediate typing

**Result:**
```
10:41 Previous entry
      Some content

11:37 ▌   ← cursor here, ready to type
```

This should feel instant — thought to captured in < 1 second.

### Event Changes (Moved/Canceled)

When a calendar event is moved or canceled, the plugin syncs the change:

**Moved event:**
```
13:00 ~~[[Nick 1:1 ~abc123]] with [[Nick Stocks]]~~  → moved to 3 Feb 15:00
      (original notes preserved)

...

15:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]      ← new entry on target day
      ┄ Briefing carried over...
```

**Canceled event:**
```
13:00 ~~[[Nick 1:1 ~abc123]] with [[Nick Stocks]]~~  canceled
      (notes preserved for reference)
```

- Original entry gets strikethrough
- Notes below the original are preserved (they're your content)
- New entry created at new time/date if moved
- Event note's `event_id` stays the same — it's the source of truth

### Event Rendering

Events show with participants inline:
```markdown
13:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]
      ┄ Weekly sync to discuss priorities
```

The plugin:
1. Detects `[[...]]` after time with `with [[...]]` participants
2. Renders event link + participant links (all as styled links)
3. Shows briefing preview below (collapsed one-liner)
4. Click event → opens event note (creates if doesn't exist)
5. Click participant → opens People note

---

## Task System

### Task as Note

Every task is a wikilink. The note contains metadata in frontmatter.

**In daily note:**
```markdown
10:17 Called Sophie
      - [ ] [[Send Sophie terms]]
```

**Task note (`Tasks/Send Sophie terms.md`):**
```yaml
---
due: 2026-02-03
priority: now
status: open
created: 2026-02-01
---

Context: Sophie needs revised pricing by Friday.

## Related
- [[Sophie Kremer]]
- [[Contracts]]
```

### Inline Rendering

**Raw markdown:**
```markdown
- [ ] [[Send Sophie terms]]
```

**Rendered:**
```
☐ [[Send Sophie terms]]  Feb 3  now
                          ↑      ↑
                         tag    tag
```

Due date and priority render as inline tags immediately after the task title.

**Interactions:**
| Element | Click Action |
|---------|--------------|
| Checkbox | Toggle status (open ↔ done) |
| Task name | Opens task note |
| Due date tag | Date picker popover |
| Priority tag | Cycles: now → next → later → (none) |

### Toggle Status From Anywhere

Task checkboxes work globally — toggle from any view:
- Temporal Drift timeline
- Task Sidebar
- Backlinks pane
- Search results
- Embedded queries

**On toggle:**
1. Checkbox state updates visually (instant)
2. Task note frontmatter `status` field updates (open ↔ done)
3. If completing: adds `completed: YYYY-MM-DD` to frontmatter
4. All other views showing this task update automatically

No need to open the task note to mark it done.

### Drag and Drop

**Tasks are fully drag-and-droppable:**

| Action | Result |
|--------|--------|
| Drag from sidebar → timeline | Creates `- [ ] [[Task]]` at drop position with timestamp |
| Drag between sidebar sections | Changes `priority` field in frontmatter |
| Drag within timeline | Moves task to different time block |

---

## Task Sidebar Plugin

### Purpose

Separate view for Now/Next/Later task triage. Lives in right sidebar.

### Visual
```
┌─────────────────────────────┐
│  TASKS                      │
├─────────────────────────────┤
│  NOW                    (3) │
│  ────                       │
│  ☐ Send Sophie terms   Feb 3│  ← drag to timeline
│  ☐ Review auth PR      today│  ← drag to NEXT
│  ☐ Finalize deck       Feb 2│
│                             │
│  NEXT                   (4) │
│  ────                       │
│  ☐ Follow up discount  Feb 5│
│  ☐ Q1 planning doc     Feb 6│
│  ☐ Competitor research Feb 7│
│  ☐ 1:1 with Anna       Feb 7│
│                             │
│  LATER                  (2) │
│  ────                       │
│  ☐ Website redesign   Feb 15│
│  ☐ Team offsite        Mar 1│
└─────────────────────────────┘
```

### Interaction

- **Click task** → opens note
- **Drag between sections** → changes `priority` field
- **Drag to timeline** → inserts task at that time
- **Checkbox** → marks complete, updates frontmatter
- **Add to Today button** → inserts task into today's timeline at current time
- **Right-click** → quick actions (reschedule, delete)

### Add to Today

Every task (in sidebar and timeline) has an "Add to Today" action:

**Desktop:** Small `+today` button on hover, or right-click menu
**Mobile:** Long-press menu option

**On click:**
1. Creates `- [ ] [[Task name]]` in today's daily note
2. Inserts at current time position
3. Visual confirmation (toast or highlight)

```
10:17 Called Sophie
      - [ ] [[Send Sophie terms]]  ← task added here

11:43 ▌  ← cursor after adding
```

This quickly schedules any task for focused work today.

### Other Item Types

Beyond tasks, three additional types for capture:

**Ideas** — Sparks that might become tasks
```yaml
# Ideas/New pricing model.md
---
created: 2026-02-01
tags: [pricing, strategy]
---

What if we tiered by usage instead of flat rate?
```
- No due date, no priority
- Lives in `Ideas/` folder
- Promote to task when actionable

**Research** — Things to explore
```yaml
# Research/Competitor pricing analysis.md
---
created: 2026-02-01
status: open
---

## Questions
- How does X price their enterprise tier?
- What's the market rate?

## Findings

```
- May have due date (deadline for research)
- Lives in `Research/` folder
- Can spawn tasks when findings need action

**Delegated For** — Things others owe you
```yaml
# Delegated/Sophie Kremer - send contract.md
---
delegated_to: "[[Sophie Kremer]]"
requested: 2026-02-01
expected_by: 2026-02-05
status: delegated
---

Asked her to send the revised contract after legal review.
```
- Has expected date (when you need it by)
- Grouped by person in sidebar
- Reminder to follow up if overdue

### Sidebar with All Types

```
NOW (3)
NEXT (4)  
LATER (2)
─────────────
DELEGATED (2)
  Sophie Kremer (1)
  Nick Stocks (1)
─────────────
IDEAS (5)
RESEARCH (2)
```

### Quick Add Task

**Shortcut:** `Ctrl + Shift + Enter`

From anywhere in Obsidian:
1. Opens quick input modal
2. Type task title
3. Enter → creates task note + adds to Now section

**In task sidebar:** Click `+` button or press `a` (add)
- Inline input field appears at top of Now section
- Type title, Enter to create
- Escape to cancel

**Result:**
```
Tasks/My new task.md created with:
---
due: (empty)
priority: now
status: open
created: 2026-02-01
---
```

Task appears in Now section, ready for due date assignment.

---

## Event Notes

### Not Every Meeting Needs a Note

**Important:** Event notes are created on-demand, not automatically for every calendar event.

**Events appear in timeline without a note:**
```markdown
13:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]
```

The link exists, but the file doesn't — until you:
- Click to open it (creates note with template)
- Add notes below it in the daily note
- Samwise adds a briefing

**This avoids cluttering the vault with empty meeting notes for routine events.**

### File Location

| Type | Location |
|------|----------|
| Recurring meetings | `Meetings/{Title} ~{meeting_id}.md` |
| One-off meetings | `Meetings/YYYY-MM/{Title} ~{meeting_id}.md` |

Recurring meetings stay in root `Meetings/` folder (consistent path across instances).
One-off meetings go to monthly subfolders to keep things organized.

### Event Frontmatter

```yaml
---
event_id: abc123@google.com
title: "Nick 1:1"
date: 2026-02-01
start_time: "13:00"
end_time: "13:30"
duration: 30
recurring: true
recurrence_rule: "RRULE:FREQ=WEEKLY;BYDAY=TU"
description: "Weekly sync to discuss priorities and blockers"
location: "Zoom"
calendar_link: "https://calendar.google.com/calendar/event?eid=..."
attachments:
  - "https://docs.google.com/document/d/..."
participants:
  - "[[Nick Stocks]]"
  - "[[Maximilian Wühr]]"
---

## Briefing
Last time you discussed board prep. He mentioned concerns about...

## Prep
- [ ] Review Q1 numbers
- [ ] Bring up hiring timeline

## Notes

```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `event_id` | ✅ | Google Calendar event ID (sync anchor) |
| `title` | ✅ | Event title |
| `date` | ✅ | Event date |
| `start_time` | ✅ | Start time (HH:mm) |
| `end_time` | ✅ | End time (HH:mm) |
| `duration` | ✅ | Duration in minutes |
| `recurring` | ✅ | Is this a recurring event? |
| `recurrence_rule` | — | iCal RRULE if recurring |
| `description` | — | Event description from calendar |
| `location` | — | Meeting location/link |
| `calendar_link` | — | Direct link to Google Calendar event |
| `attachments` | — | Links to attached documents |
| `participants` | — | Wikilinks to People notes |

### Daily Note Format with Participants

Events in the daily note show participants inline:

```markdown
09:00 [[Standup ~xyz789]] with [[Anna Meyer]], [[Tom Schmidt]], [[Lisa Chen]]
      ┄ Sprint priorities, blockers

13:00 [[Nick 1:1 ~abc123]] with [[Nick Stocks]]
      ┄ Weekly sync

15:00 [[Board prep ~def456]] with [[Nathan Blecharczyk]], [[Fabian Heilemann]]
      ┄ Q4 review presentation
```

**Format:** `HH:mm [[{Title} ~{meeting_id}]] with [[Person 1]], [[Person 2]], ...`

### Participant Linking

**Email is the source of truth for matching participants to People notes.**

Flow when a meeting is processed:
1. Get attendee emails from Google Calendar event
2. For each attendee email:
   - Search vault for People note with matching `email:` frontmatter
   - If found → use that note's filename for wikilink
   - If not found → create new People note

**People note creation:**
```yaml
# People/Nick Stocks.md
---
title: 
organization: "[[]]"
location: 
phone: 
email: nick.stocks@company.com
researched: false
created: 2026-02-01
tags:
  - person
---
```

**Auto-research:** When `researched: false`, the plugin can trigger research to populate:
- Title/role
- Organization (with wikilink)
- Location
- Summary from email history and web search

### Meeting Note Indicators

Visual indicators in the timeline show meeting note state:

```
13:00 [[Nick 1:1 ~abc123]] ● with [[Nick Stocks]]
      ┄ Weekly sync
```

| Indicator        | Meaning                | Detection                             |
| ---------------- | ---------------------- | ------------------------------------- |
| `◦` (filled dot) | Note exists            | File found in vault                   |
| (no dot)         | Note doesn't exist yet | File not found                        |
| `●`              | Has transcript         | `has_transcript: true` in frontmatter |

### Transcript in Meeting Note

Transcripts live directly in the meeting note under `## Transcript`:

```markdown
---
event_id: abc123
date: 2026-02-01
start_time: "13:00"
end_time: "13:30"
has_transcript: true
transcript_source: amie
participants:
  - "[[Nick Stocks]]"
---

## Briefing
Last time you discussed board prep.

## Prep
- [ ] Review Q1 numbers

## Notes
- Agreed to push deadline to Friday
- Nick will handle investor call

## Transcript

**Nick Stocks** (13:00): Hey, thanks for joining.

**Maximilian Wühr** (13:00): Of course, let's dive in.

**Nick Stocks** (13:01): So about the Q4 numbers...
```

**Transcript sources:**
- Amie (via webhook)
- Manual paste

`has_transcript: true` in frontmatter enables the 🎙️ indicator.

### Integration from GetShitDone Plugin

Temporal Drift integrates patterns from the GetShitDone plugin:

| Feature | Description |
|---------|-------------|
| **Calendar Service** | Wrapper for Google Calendar plugin API |
| **Person Research** | AI-powered research using email history + web |
| **Meeting Briefings** | AI-generated briefings using vault context |
| **Participant Filtering** | Excludes rooms, resources, self |
| **Vault Search** | Finds related notes, parses frontmatter |
| **Index Service** | In-memory indexes for fast People/Org lookups |

**Key patterns to port:**
1. `ensurePeopleNotes()` — Create People notes for participants by email
2. `filterParticipants()` — Exclude rooms/resources/self
3. `resolveFolder()` — Route recurring vs one-off meetings
4. `humanizeEmail()` — Convert `nick.stocks@company.com` → "Nick Stocks"
5. Briefing queue with parallel processing and rate limiting

---

## OpenClaw Integration

### What Samwise Can Do

**Read:**
- Daily note timeline (what Maxi is working on)
- Focus section (today's priorities)
- Task notes (status, due dates, priority)
- Event notes (prep, context)

**Write:**
- Event briefings (update before meetings)
- Create task notes (when Maxi says "remind me to...")
- Add entries to timeline

### Briefing Updates

Before meetings, Samwise:
1. Checks calendar for upcoming events
2. Finds/creates event note
3. Updates `## Briefing` section with context
4. Does NOT touch `## Notes` (Maxi's space)

---

## File Locations

| Type          | Path                                    | Syncs to Google Tasks |
| ------------- | --------------------------------------- | --------------------- |
| Daily notes   | `Daily notes/YYYY-MM-DD.md`             | —                     |
| Tasks (Now)   | `Tasks/Now/{Task name}.md`              | ✅ Yes                 |
| Tasks (Next)  | `Tasks/Next/{Task name}.md`             | ✅ Yes                 |
| Tasks (Later) | `Tasks/Later/{Task name}.md`            | ✅ Yes                 |
| Tasks (Done)  | `Tasks/Done/{Task name}.md`             | ✅ Yes                 |
| Ideas         | `Thoughts/Ideas/{Idea name}.md`         | ❌ No                  |
| Research      | `Thoughts/Research/{Topic}.md`          | ❌ No                  |
| Delegated     | `Tasks/Delegated/{Person} - {thing}.md` | ❌ No                  |
| Events (recurring) | `Meetings/{Title} ~{meeting_id}.md`     | —                     |
| Events (one-off) | `Meetings/YYYY-MM/{Title} ~{meeting_id}.md` | —                 |
| People        | `People/{Name}.md`                      | —                     |

**On priority change:** Task file moves between `Now/`, `Next/`, `Later/` folders. Obsidian auto-updates links.

**Only Tasks sync to Google Tasks.** Ideas, Research, and Delegated are Obsidian-only.

---

## Mobile Experience

### Layout

- Sidebar hidden by default (screen width < 768px)
- Timeline takes full width
- Calendar strip shows 5 days (scrollable)
- FAB (floating action button) bottom-right for quick capture

### Touch Interactions

| Gesture               | Action                                                    |
| --------------------- | --------------------------------------------------------- |
| Tap checkbox          | Toggle task complete                                      |
| Tap task              | Open task note                                            |
| Tap date/priority tag | Picker/cycle                                              |
| **Long-press task**   | Context menu (complete, reschedule, add to today, delete) |
| Long-press time entry | Edit/delete options                                       |
| Pull down             | Refresh/sync calendar                                     |
| Swipe from right edge | Reveal task sidebar (if feasible)                         |

**Note:** Custom swipe gestures on list items may conflict with Obsidian navigation. Long-press menu is the reliable fallback.

### Quick Capture (Mobile)

No keyboard shortcuts on mobile. Instead:
- **FAB button** (`+`) bottom-right corner
- Tap → inserts timestamp, keyboard opens
- Or: Pull down on timeline to add entry at top

### Task Sidebar (Mobile)

Options for accessing on mobile:
1. **Bottom sheet** — swipe up from bottom edge
2. **Tab bar** — toggle between Timeline / Tasks views
3. **Slide-over** — swipe from right edge (may conflict)

Recommend: **Tab bar** at bottom — `Timeline | Tasks` — simple, no gesture conflicts.

---

## Plugin Settings

### Temporal Drift Plugin Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dailyNotesFolder` | `Daily notes` | Folder for daily notes |
| `dateFormat` | `YYYY-MM-DD` | Daily note filename format |
| `tasksFolder` | `Tasks` | Root folder for tasks (subfolders: Now/, Next/, Later/, Done/) |
| `meetingsFolder` | `Meetings` | Folder for event/meeting notes |
| `peopleFolder` | `People` | Folder for people notes |
| `defaultPriority` | `now` | Priority for new tasks |
| `quickCaptureHotkey` | `⌘⇧N` | Global quick capture shortcut |
| `newTaskHotkey` | `Ctrl+Shift+Enter` | Quick add task shortcut |
| `theme` | `light` | Default theme (`light` or `dark`) |
| `showThankful` | `true` | Show "Thankful for" section |
| `showFocus` | `true` | Show "Focus" section |
| `calendarDays` | `7` | Days to show in calendar strip |

### Task Note Template

Configurable template for new task notes:
```yaml
---
due: {{due}}
priority: {{priority}}
status: open
created: {{date}}
---

{{cursor}}
```

### Event Note Template

Configurable template for new event notes:
```yaml
---
event_id: {{event_id}}
date: {{date}}
time: {{time}}
duration: {{duration}}
participants: {{participants}}
---

## Briefing


## Prep
- [ ] 

## Notes

```

---

## Resolved Questions

1. **Recurring events:** One note per meeting (same `event_id`). Content appends to existing note.
2. **Task archival:** Completed tasks move to `Tasks/Done/`. Active tasks organized by priority folders.
3. **Time granularity:** Minutes (`HH:mm`). If same minute, reuse or increment. Doesn't need to be exact.
4. **Conflict resolution:** Compare modification times. Most recently modified wins (usually frontmatter).
5. **Overdue tasks:** Visual indicator (red/warning styling). Stays in original priority section.
6. **Offline mode:** Queue changes locally, sync when connection restored.
7. **Search:** Not needed — rely on Obsidian global search.
8. **Attachments:** Links only, no file attachments in task notes.

---

## MVP Scope

### Phase 1: Temporal Drift Core
- [ ] Calendar strip with week view
- [ ] Time-as-numeration rendering
- [ ] Dual typography (monospace titles, sans-serif content)
- [ ] Single font size throughout
- [ ] **Daily note creation command** (with template + events)
- [ ] **Templater integration hook**
- [ ] **URI scheme** (`obsidian://temporal-drift/create?date=...`)
- [ ] Auto-timestamp on Enter
- [ ] **Quick capture shortcut** (`⌘⇧N` global, `Ctrl+Enter` in view)
- [ ] **Keyboard navigation** (`j/k` or arrows between entries)
- [ ] Scrollable timeline with previous days
- [ ] Current time indicator

### Phase 2: Event Integration
- [ ] Google Calendar plugin setup
- [ ] Event note linking (always linked, contains event_id)
- [ ] Smart link display (rendered vs raw on cursor)
- [ ] Briefing preview (collapsed one-liner)
- [ ] Participant linking (email → People)

### Phase 3: Task Inline
- [ ] Task detection (`- [ ] [[...]]`)
- [ ] Read frontmatter (due, priority, status)
- [ ] Render inline tags: `☐ [[name]]  date  priority`
- [ ] Click-to-edit date (date picker)
- [ ] Click-to-cycle priority (now/next/later)
- [ ] Checkbox ↔ status sync
- [ ] **Toggle status from anywhere** (updates frontmatter instantly)
- [ ] Auto-create task note on new `[[task]]`

### Phase 4: Task Sidebar + Drag/Drop
- [ ] Now/Next/Later views
- [ ] Drag between sections → changes priority
- [ ] Drag to timeline → inserts task with timestamp
- [ ] Drag within timeline → moves task

### Phase 5: Google Tasks Sync
- [ ] OAuth 2.0 flow in plugin
- [ ] Push task to Google on create/edit
- [ ] Pull tasks from Google on sync
- [ ] Priority emoji in title (⏫/🔼/🔽)
- [ ] Due date + time sync
- [ ] Conflict resolution (newest wins)
- [ ] Sync interval setting

### Phase 6: OpenClaw Integration
- [ ] Briefing auto-update before meetings
- [ ] Task creation from chat
- [ ] Daily note awareness

---

## Google Tasks Sync

### Overview

Plugin-native bi-directional sync with Google Tasks. Obsidian is the source of truth.

### Authentication

- OAuth 2.0 flow built into plugin
- Stored in Obsidian's secure settings
- User authorizes via Google consent screen on first sync

### Field Mapping

| Obsidian Task Note | Google Tasks | Direction |
|--------------------|--------------|-----------|
| Filename | Title | ↔ |
| `due` (date) | Due date | ↔ |
| `due` (time) | Due time | ↔ |
| `status` | Completed | ↔ |
| `priority` in title | Title prefix | → |
| **Note body content** | **Description/Notes** | **↔** |
| `google_task_id` | Task ID | ← (stored for sync) |
| `google_list_id` | List ID | ← (stored for sync) |

### Note Content ↔ Description Sync

The body content of a task note (everything below the frontmatter) syncs to the Google Tasks description field:

**Obsidian task note:**
```markdown
---
due: 2026-02-03
priority: now
status: open
---

Context: Sophie needs revised pricing by Friday.
Legal approved 15% discount ceiling.

## Notes
- Called her on Feb 1
- She's checking with her team
```

**Syncs to Google Tasks description:**
```
Context: Sophie needs revised pricing by Friday.
Legal approved 15% discount ceiling.

## Notes
- Called her on Feb 1
- She's checking with her team
```

**Behavior:**
- Markdown is preserved (Google Tasks renders as plain text)
- Changes in Obsidian → update Google Tasks description
- Changes in Google Tasks → update Obsidian note body
- Frontmatter is never synced to description (only body content)

### Title Encoding

Now/next/later and priority sync via title prefix/suffix:

**Now/Next/Later (prefix):**
| Value | Prefix | Example |
|-------|--------|---------|
| `now` | `[NOW]` | "[NOW] Send Sophie terms" |
| `next` | `[NEXT]` | "[NEXT] Review PR" |
| `later` | `[LATER]` | "[LATER] Website redesign" |

**Full example in Google Tasks:**
```
[NOW] Send Sophie terms
```

On sync from Google → Obsidian:
- Prefix parsed → `priority: now` (when)
- Both stripped from filename

**Task note frontmatter:**
```yaml
---
due: 2026-02-03T14:00
priority: now        # now | next | later
importance: high     # high | medium | low (optional)
status: open
---
```

### Task Note with Sync

```yaml
---
due: 2026-02-03T14:00
priority: now
status: open
created: 2026-02-01
google_task_id: MTIzNDU2Nzg5
google_list_id: MDEyMzQ1Njc4OQ
last_synced: 2026-02-01T12:00:00Z
---

Context: Sophie needs revised pricing by Friday.
```

### Sync Behavior

| Trigger | Action |
|---------|--------|
| Task created in Obsidian | Push to Google Tasks |
| Task edited in Obsidian | Update in Google Tasks |
| Task completed in Obsidian | Mark complete in Google |
| Task created in Google | Pull to Obsidian (creates note) |
| Task edited in Google | Update Obsidian note |
| Task completed in Google | Update `status: done` in Obsidian |

### Conflict Resolution

If edited in both places since last sync:
1. Compare `last_synced` vs modification times
2. Most recent edit wins
3. Log conflict in sync history

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `googleTasksEnabled` | `false` | Enable Google Tasks sync |
| `googleTasksList` | `My Tasks` | Which list to sync |
| `syncInterval` | `5min` | Auto-sync frequency |
| `syncOnStartup` | `true` | Sync when Obsidian opens |
| `conflictResolution` | `newest` | `newest` or `obsidian-wins` |

### What's NOT Synced

- Recurrence (not needed)
- Reminders (not needed)
- Subtasks (flatten for now)

---

## Reference

- [Temporal Drift VISION.md](file:///~/Workspace/projects/temporal-drift/VISION.md)
- [Prototype](file:///~/Workspace/projects/temporal-drift/prototype/temporal-drift.html)
- [obsidian-google-calendar plugin](https://github.com/YukiGasworker/obsidian-google-calendar)
