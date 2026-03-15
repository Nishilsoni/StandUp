/**
 * Time utility functions for the StandUp extension.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 * e.g. 8100000 → "2h 15m"
 */
export function formatDuration(ms: number): string {
    if (ms < 0) { ms = 0; }
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0 && minutes === 0) {
        const seconds = Math.floor(ms / 1000);
        return `${seconds}s`;
    }
    if (hours === 0) {
        return `${minutes}m`;
    }
    if (minutes === 0) {
        return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function getToday(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Get yesterday's date as YYYY-MM-DD string.
 */
export function getYesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

/**
 * Check if a given date string (YYYY-MM-DD) or Date object is today.
 */
export function isToday(date: string | Date): boolean {
    const d = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return d === getToday();
}

/**
 * Get the relative day label for a date.
 */
export function getRelativeDay(date: string): string {
    if (date === getToday()) { return 'Today'; }
    if (date === getYesterday()) { return 'Yesterday'; }
    return date;
}

/**
 * Get hours and minutes from an HH:MM string.
 */
export function parseTime(timeStr: string): { hours: number; minutes: number } {
    const [h, m] = timeStr.split(':').map(Number);
    return { hours: h || 0, minutes: m || 0 };
}

/**
 * Get a timestamp for the start of today (midnight).
 */
export function getStartOfToday(): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
}
