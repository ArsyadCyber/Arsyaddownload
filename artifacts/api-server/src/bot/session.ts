export interface VideoSession {
  url: string;
  title: string;
  uploader: string;
  duration: string;
  resolutions: Resolution[];
  createdAt: number;
}

export interface Resolution {
  label: string;
  formatId: string;
  height: number | null;
  audioOnly: boolean;
}

const store = new Map<string, VideoSession>();
const TTL_MS = 10 * 60 * 1000;

export function saveSession(key: string, session: VideoSession): void {
  store.set(key, session);
  setTimeout(() => store.delete(key), TTL_MS);
}

export function getSession(key: string): VideoSession | undefined {
  return store.get(key);
}

export function deleteSession(key: string): void {
  store.delete(key);
}

export function generateKey(chatId: number, userId: number): string {
  return `${chatId}_${userId}_${Date.now()}`;
}
