// ============================================================================
// Time Utilities
// ============================================================================

/**
 * Format a date as HH:mm
 */
export function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a date string (YYYY-MM-DD) to Date
 */
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Get day of week name (short)
 */
export function getDayName(date: Date, short = true): string {
  const days = short
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
}

/**
 * Get month name
 */
export function getMonthName(date: Date, short = true): string {
  const months = short
    ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    : [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
  return months[date.getMonth()];
}

/**
 * Format date for display (e.g., "Mon 3")
 */
export function formatDayShort(date: Date): string {
  return `${getDayName(date)} ${date.getDate()}`;
}

/**
 * Format date for aria-label (e.g., "Monday, February 3")
 */
export function formatDayLong(date: Date): string {
  return `${getDayName(date, false)}, ${getMonthName(date, false)} ${date.getDate()}`;
}
