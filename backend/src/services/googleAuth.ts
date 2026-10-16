import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';

const client = new OAuth2Client(env.google.clientId);

export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string; sub: string }> {
  const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) throw new Error('Invalid Google token');
  if (payload.email_verified !== true) throw new Error('Google account email is not verified');
  return { email: payload.email, sub: payload.sub };
}
