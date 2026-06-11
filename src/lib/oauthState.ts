import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

export interface OAuthStatePayload {
  wsId:  string;
  ret:   string;  // return URL after auth
  nonce: string;
  ts:    number;  // unix seconds
}

const TTL_SECONDS = 600;

function hmacOf(p: OAuthStatePayload, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${p.wsId}|${p.ret}|${p.nonce}|${p.ts}`)
    .digest('hex');
}

export function encodeState(
  wsId: string,
  ret: string,
  secret: string,
): { encoded: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const ts    = Math.floor(Date.now() / 1000);
  const payload: OAuthStatePayload = { wsId, ret, nonce, ts };
  const sig     = hmacOf(payload, secret);
  const encoded = Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url');
  return { encoded, nonce };
}

export function decodeState(
  encoded: string,
  secret: string,
): { ok: true; state: OAuthStatePayload } | { ok: false; error: string } {
  let raw: OAuthStatePayload & { sig?: string };
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  } catch {
    return { ok: false, error: 'state_parse_failed' };
  }

  const { sig, ...payload } = raw as OAuthStatePayload & { sig?: string };
  if (!payload.wsId || !payload.ret || !payload.nonce || !payload.ts) {
    return { ok: false, error: 'state_missing_fields' };
  }

  const expected    = hmacOf(payload, secret);
  const sigBuf      = Buffer.from(sig ?? '', 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: 'state_sig_invalid' };
  }

  const age = Math.floor(Date.now() / 1000) - payload.ts;
  if (age < 0 || age > TTL_SECONDS) {
    return { ok: false, error: 'state_expired' };
  }

  return { ok: true, state: payload };
}

// Validate that a return URL is safe (relative path or known glenvex domain).
export function safeReturnUrl(ret: string, fallback: string): string {
  if (ret.startsWith('/')) return ret;
  try {
    const u = new URL(ret);
    if (!['https:', 'http:'].includes(u.protocol)) return fallback;
    const host = u.hostname;
    if (host === 'localhost' || host.endsWith('.glenvex.com') || host === 'glenvex.com') {
      return ret;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
