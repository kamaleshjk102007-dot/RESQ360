export const DEFAULT_SENDER_NAME = 'Someone';
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * Normalizes a display name for storage/sending:
 * - trims leading/trailing whitespace
 * - caps length at MAX_DISPLAY_NAME_LENGTH
 * - falls back to DEFAULT_SENDER_NAME when empty
 */
export function normalizeDisplayName(rawName) {
  const trimmed = String(rawName || '').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed || DEFAULT_SENDER_NAME;
}
