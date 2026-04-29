export function utcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
