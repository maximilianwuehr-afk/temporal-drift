import {
  contextIconForLine,
  TimelineCardModel,
  TimelineCardParticipant,
} from "./card-model";

const MAX_BODY_LINES = 8;
const MAX_VISIBLE_PARTICIPANTS = 3;

function getInitials(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface TimelineCardDomActions {
  onTimeClick?: () => void;
  onCardClick?: () => void;
  onCardDoubleClick?: () => void;
  onPrimaryClick?: () => void;
  onParticipantClick?: (participant: TimelineCardParticipant) => void;
  onJoinClick?: (url: string) => void;
  onTaskToggle?: () => void;
}

export interface TimelineCardDomOptions {
  maxBodyLines?: number;
  maxVisibleParticipants?: number;
  entryAriaLabel?: string;
  actions?: TimelineCardDomActions;
}

export interface TimelineCardDomRefs {
  root: HTMLElement;
  hourEl: HTMLElement;
  timeEl: HTMLElement;
  cardEl: HTMLElement;
}

function addAction(el: HTMLElement, fn?: () => void): void {
  if (!fn) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
}

export function renderTimelineCardDom(
  model: TimelineCardModel,
  options: TimelineCardDomOptions = {}
): TimelineCardDomRefs {
  const maxBodyLines = options.maxBodyLines ?? MAX_BODY_LINES;
  const maxVisibleParticipants = options.maxVisibleParticipants ?? MAX_VISIBLE_PARTICIPANTS;
  const actions = options.actions ?? {};

  const root = document.createElement("div");
  root.className = "td-live-preview";

  const hour = document.createElement("div");
  hour.className = "hour";

  const timeEl = document.createElement("div");
  timeEl.className = "hour-time";

  if (model.isNow) {
    hour.classList.add("now");
    timeEl.classList.add("is-now");

    const dot = document.createElement("span");
    dot.className = "now-dot";
    dot.textContent = "●";
    timeEl.appendChild(dot);
  }

  timeEl.appendChild(document.createTextNode(model.time));
  addAction(timeEl, actions.onTimeClick);

  const slot = document.createElement("div");
  slot.className = "hour-slot";

  const card = document.createElement("div");
  card.className = "event";
  if (model.isNow) card.classList.add("active");
  if (model.kind === "task") card.classList.add("event--task");
  if (model.kind === "task" && model.taskDone) card.classList.add("event--task-done");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", options.entryAriaLabel ?? `Timeline entry ${model.time}`);

  if (model.kind === "task") {
    const headline = document.createElement("div");
    headline.className = "event-headline";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "task-checkbox";
    toggle.checked = model.taskDone;
    toggle.setAttribute("aria-label", model.taskDone ? "Mark task as open" : "Mark task as done");

    if (actions.onTaskToggle) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.onTaskToggle?.();
      });
    } else {
      toggle.disabled = true;
    }

    headline.appendChild(toggle);

    const title = document.createElement(model.primaryLinkTarget && actions.onPrimaryClick ? "a" : "span");
    title.className = `event-title${model.primaryLinkTarget && actions.onPrimaryClick ? " event-title-link" : ""}`;
    if (model.taskDone) title.classList.add("task-title-done");
    title.textContent = model.title;

    if (title instanceof HTMLAnchorElement) {
      title.href = "#";
      title.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.onPrimaryClick?.();
      });
    }

    headline.appendChild(title);

    if (model.taskPriority) {
      const priority = document.createElement("span");
      priority.className = `task-priority task-priority-${model.taskPriority}`;
      priority.textContent = `#${model.taskPriority}`;
      headline.appendChild(priority);
    }

    card.appendChild(headline);
  } else {
    const top = document.createElement("div");
    top.className = "event-top";

    const left = document.createElement("div");
    left.className = "event-main";

    const title = document.createElement(model.primaryLinkTarget && actions.onPrimaryClick ? "a" : "span");
    title.className = `event-title${model.primaryLinkTarget && actions.onPrimaryClick ? " event-title-link" : ""}`;
    title.textContent = model.title;

    if (title instanceof HTMLAnchorElement) {
      title.href = "#";
      title.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.onPrimaryClick?.();
      });
    }

    left.appendChild(title);

    if (model.locationText) {
      const location = document.createElement("div");
      location.className = "event-location";
      location.textContent = model.locationText;
      left.appendChild(location);
    }

    const right = document.createElement("div");
    right.className = "event-right";

    if (model.durationText) {
      const duration = document.createElement("span");
      duration.className = "event-duration";
      duration.textContent = model.durationText;
      right.appendChild(duration);
    }

    if (model.joinUrl && actions.onJoinClick) {
      const join = document.createElement("a");
      join.className = "join-pill";
      join.href = "#";
      join.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>Join`;
      join.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        actions.onJoinClick?.(model.joinUrl!);
      });
      right.appendChild(join);
    }

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);
  }

  if (model.participants.length > 0) {
    const peopleRow = document.createElement("div");
    peopleRow.className = "event-participants";

    const visibleParticipants = model.participants.slice(0, maxVisibleParticipants);
    for (const p of visibleParticipants) {
      const person = document.createElement(actions.onParticipantClick ? "a" : "span");
      person.className = "participant";

      if (person instanceof HTMLAnchorElement) {
        person.href = "#";
        person.setAttribute("role", "button");
        person.setAttribute("aria-label", `Open ${p.display}`);
        person.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          actions.onParticipantClick?.(p);
        });
      }

      const avatar = document.createElement("span");
      avatar.className = "participant-avatar";
      avatar.textContent = getInitials(p.display);
      person.appendChild(avatar);

      const label = document.createElement("span");
      label.className = "participant-label";
      label.textContent = p.display;
      person.appendChild(label);

      peopleRow.appendChild(person);
    }

    const overflow = model.participants.length - visibleParticipants.length;
    if (overflow > 0) {
      const more = document.createElement("span");
      more.className = "participant participant-more";

      const av = document.createElement("span");
      av.className = "participant-avatar";
      av.textContent = `+${overflow}`;
      more.appendChild(av);

      const text = document.createElement("span");
      text.className = "participant-label";
      text.textContent = `${overflow} attendees`;
      more.appendChild(text);

      peopleRow.appendChild(more);
    }

    card.appendChild(peopleRow);
  }

  if (model.contextLines.length > 0) {
    const context = document.createElement("div");
    context.className = "event-context";

    const visible = model.contextLines.slice(0, maxBodyLines);
    for (const line of visible) {
      const contextLine = document.createElement("div");
      contextLine.className = "context-line";

      const icon = document.createElement("span");
      icon.className = "context-icon";
      icon.textContent = contextIconForLine(line);
      contextLine.appendChild(icon);

      const text = document.createElement("span");
      text.className = "context-text";
      text.textContent = line;
      contextLine.appendChild(text);

      context.appendChild(contextLine);
    }

    const overflow = model.contextLines.length - visible.length;
    if (overflow > 0) {
      const moreLine = document.createElement("div");
      moreLine.className = "context-line context-line-more";

      const icon = document.createElement("span");
      icon.className = "context-icon";
      icon.textContent = "…";
      moreLine.appendChild(icon);

      const text = document.createElement("span");
      text.className = "context-text";
      text.textContent = `${overflow} more note${overflow === 1 ? "" : "s"}`;
      moreLine.appendChild(text);

      context.appendChild(moreLine);
    }

    card.appendChild(context);
  }

  addAction(card, actions.onCardClick);

  if (actions.onCardDoubleClick) {
    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      actions.onCardDoubleClick?.();
    });
  }

  slot.appendChild(card);
  hour.appendChild(timeEl);
  hour.appendChild(slot);
  root.appendChild(hour);

  return {
    root,
    hourEl: hour,
    timeEl,
    cardEl: card,
  };
}
