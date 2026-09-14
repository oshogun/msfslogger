import multer from 'multer';

/**
 * The multipart upload limits, in one place because two of them are read twice:
 * the routes that accept the file, and src/server.ts's error handler, which
 * turns a MulterError back into the message that names the limit it hit.
 */

// Multer's own defaults are `fields: Infinity` and `fieldSize: 1MB`, so a
// multipart request could otherwise carry unbounded non-file fields. A
// legitimate PDF upload sends one file and no fields; the .lnmpln import sends
// at most 25 files and one field (allow_duplicates).
export const MAX_FLIGHT_PLAN_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_FIELDS = 5;
const MAX_UPLOAD_FIELD_BYTES = 8192;
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FLIGHT_PLAN_BYTES,
    files: 1,
    fields: MAX_UPLOAD_FIELDS,
    fieldSize: MAX_UPLOAD_FIELD_BYTES,
    parts: 1 + MAX_UPLOAD_FIELDS,   // 6 — one file plus the field allowance
  },
});

// ── LNMPLN import ──────────────────────────────────────────────────────────
// A separate multer instance, deliberately: a real .lnmpln plan is a few KB of
// XML, so it gets its own, much smaller, limit rather than sharing
// MAX_FLIGHT_PLAN_BYTES (20 MB, PDFs).
export const MAX_LNMPLN_BYTES = 512 * 1024;
export const MAX_LNMPLN_FILES = 25;
export const uploadLnmpln = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_LNMPLN_BYTES,
    files: MAX_LNMPLN_FILES,
    fields: MAX_UPLOAD_FIELDS,
    fieldSize: MAX_UPLOAD_FIELD_BYTES,
    parts: MAX_LNMPLN_FILES + MAX_UPLOAD_FIELDS + 1,   // 31 — 25 files plus the field allowance
  },
});
