# Temporal Drift Design Reference

## Target: Match the HTML Prototype

Reference: `PROTOTYPE.html` (copied from `~/Workspace/projects/temporal-drift/prototype/index.html`)

## Color Palette (from prototype)

```css
--bg-primary: #FAF9F7;
--bg-secondary: #F2F0ED;
--bg-active: #FFFFFF;
--text-primary: #1A1A1A;
--text-secondary: #6B6B6B;
--text-tertiary: #9B9B9B;
--accent: #C45D3A;  /* Clay/terracotta — NOT amber */
--accent-subtle: rgba(196, 93, 58, 0.06);
--accent-light: rgba(196, 93, 58, 0.03);
--border: #E5E3DF;
--border-light: #EFEDE9;
```

## Typography

- **Single font**: Inter only (no monospace for times)
- Font features: `'cv02', 'cv03', 'cv04', 'cv11', 'tnum'`
- Tabular nums for times: `font-variant-numeric: tabular-nums`

## Layout

Two-panel (for full app, but we're plugin — just the calendar/timeline side):

```
┌─────────────────────────────────────────┐
│ TODAY                                   │
│ Monday, January 27                      │
├─────────────────────────────────────────┤
│ 09:00 │ ● Event Card                    │  ← Current time has dot
│       │   - Title + Location            │
│       │   - Duration badge              │
│       │   - Participants (avatars)      │
│       │   - Context briefing            │
│       │   - Notes field                 │
│       │                                 │
│ 10:00 │ Event Card                      │
│       │                                 │
│ 11:00 │ + add                           │  ← Empty slot, hover to add
│       │                                 │
└─────────────────────────────────────────┘
```

## Event Card Structure

```html
<div class="event">
  <div class="event-top">
    <div>
      <div class="event-title">1:1 with Sarah Chen</div>
      <div class="event-location">Google Meet · Board prep</div>
    </div>
    <div class="event-right">
      <span class="event-duration">30m</span>
      <button class="record-btn">●</button>
    </div>
  </div>
  
  <div class="event-participants">
    <a class="participant">
      <span class="participant-avatar">SC</span>
      Sarah Chen
    </a>
  </div>

  <div class="event-context">
    <div class="context-line">→ Open thread: Q4 numbers</div>
    <div class="context-line">↺ Last met Jan 15</div>
  </div>

  <div class="event-notes">
    <textarea placeholder="Notes..."></textarea>
  </div>
</div>
```

## Key Interactions

- **j/k**: Navigate between events
- **Tab**: Switch panels (if inbox exists)
- **Click event**: Open linked note
- **Click participant**: Open People note
- **Hover empty slot**: Shows "+ add"
- **Record button**: Toggle recording state

## Implementation Architecture

1. **TemporalDriftView** (ItemView) — Main custom view
2. **TimelineRenderer** — Parses markdown, renders hour grid
3. **EventCard** — Component for event rendering
4. **ParticipantChip** — Avatar + name component
5. **ContextBriefing** — Briefing section component

Markdown remains source of truth. View reads daily note, renders rich UI, writes changes back.
