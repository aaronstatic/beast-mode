// In-memory session store for Discord OAuth2 authenticated users.

export interface Session {
  userId: string; // Discord user ID
  username: string; // Discord username
  avatar: string | null; // Discord avatar hash
  expiresAt: number; // Date.now() + TTL
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Map<sessionId, Session>
const sessions = new Map<string, Session>();

export function createSession(
  userId: string,
  username: string,
  avatar: string | null
): string {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    userId,
    username,
    avatar,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

export function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// GC: clean expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}, 60 * 60 * 1000);
