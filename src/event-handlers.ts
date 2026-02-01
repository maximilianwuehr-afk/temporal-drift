// ============================================================================
// Temporal Drift Event Handlers
// ============================================================================

import { App } from "obsidian";
import { formatDate, formatTime } from "./utils/time";
import { DailyNoteService } from "./services/daily-note";

/**
 * Register URI protocol handlers for temporal-drift://
 *
 * Supported actions:
 * - temporal-drift://open-today
 * - temporal-drift://open-date?date=2026-02-01
 * - temporal-drift://add-entry?text=Hello
 */
export function registerProtocolHandlers(
  app: App,
  dailyNoteService: DailyNoteService,
  activateView: () => Promise<void>
): void {
  // Register the obsidian protocol handler
  app.workspace.onLayoutReady(() => {
    // Protocol: obsidian://temporal-drift?action=open-today
    (app as any).registerObsidianProtocolHandler(
      "temporal-drift",
      async (params: { action?: string; date?: string; text?: string }) => {
        const { action, date, text } = params;

        switch (action) {
          case "open-today":
            await dailyNoteService.openToday();
            break;

          case "open-date":
            if (date) {
              await dailyNoteService.openDailyNote(date);
            } else {
              await dailyNoteService.openToday();
            }
            break;

          case "add-entry":
            if (text) {
              const today = formatDate(new Date());
              const time = formatTime(new Date());
              await dailyNoteService.appendEntry(today, time, text);
              await dailyNoteService.openDailyNote(today);
            }
            break;

          case "open-view":
            await activateView();
            break;

          default:
            // Default to opening today's note
            await dailyNoteService.openToday();
        }
      }
    );
  });
}
