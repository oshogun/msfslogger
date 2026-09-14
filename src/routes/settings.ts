import express, { Router } from 'express';
import { getSetting, setSetting } from '../db';
import { SIMBRIEF_USER_ID_SETTING, validateSimbriefUserId } from '../simbrief';

/**
 * /api/settings — mounted at '/api' by src/server.ts, so requireAuth gates both
 * routes and requireSameOrigin already CSRF-defends the write.
 *
 * Mounted at '/api' rather than '/api/settings' on purpose: the app-level error
 * handler keys off req.path.startsWith('/api/settings/') to turn a malformed
 * JSON body into INVALID_BODY, and a narrower mount would be bypassed entirely
 * by express.json() rejecting the body before routing.
 */
export function createSettingsRouter(): Router {
  const router = express.Router();

  router.get('/settings/simbrief', (_req, res) => {
    // Always 200: an unset setting is a value (null), not a 404, so the client
    // never branches on a status to render an empty text box.
    res.json({ simbrief_user_id: getSetting(SIMBRIEF_USER_ID_SETTING) });
  });

  router.put('/settings/simbrief', (req, res) => {
    const body = req.body as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid request body', code: 'INVALID_BODY' });
      return;
    }

    const result = validateSimbriefUserId((body as Record<string, unknown>).simbrief_user_id);
    if (!result.ok) {
      res.status(400).json({ error: result.error, code: result.code });
      return;
    }

    try {
      setSetting(SIMBRIEF_USER_ID_SETTING, result.userId);
      // Echo what was stored, post-trim, so the client renders what was saved
      // rather than what it typed.
      res.json({ simbrief_user_id: result.userId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
