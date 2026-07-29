import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';

const client = new OAuth2Client(env.google.clientId);

export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string }> {
  const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error('Invalid Google token');
  return { email: payload.email };
}
