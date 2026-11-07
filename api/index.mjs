// Vercel function: every /api/* request is rewritten here (see vercel.json).
import { handleApi } from "../lib/app.mjs";

export default function handler(req, res) {
  // Vercel passes the original path in req.url thanks to the rewrite; keep it as /api/...
  return handleApi(req, res);
}
