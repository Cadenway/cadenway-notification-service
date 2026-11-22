/** Retention windows for contact originals alongside the separate opaque replay receipts. */
export const contactRetention = {
  sentHours: 24,
  undeliveredDays: 30,
} as const;
