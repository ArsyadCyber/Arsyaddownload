const TTL_MS = 10 * 60 * 1000;

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

export interface TikTokSession {
  title: string;
  videoWithWatermark: string[];
  videoNoWatermark: string[];
  audio: string[];
  createdAt: number;
}

function makeStore<T>() {
  const store = new Map<string, T>();
  return {
    save(key: string, value: T) {
      store.set(key, value);
      setTimeout(() => store.delete(key), TTL_MS);
    },
    get(key: string): T | undefined {
      return store.get(key);
    },
    delete(key: string) {
      store.delete(key);
    },
  };
}

const ytStore = makeStore<VideoSession>();
const ttStore = makeStore<TikTokSession>();

export function saveSession(key: string, session: VideoSession): void {
  ytStore.save(key, session);
}
export function getSession(key: string): VideoSession | undefined {
  return ytStore.get(key);
}
export function deleteSession(key: string): void {
  ytStore.delete(key);
}

export function saveTtSession(key: string, session: TikTokSession): void {
  ttStore.save(key, session);
}
export function getTtSession(key: string): TikTokSession | undefined {
  return ttStore.get(key);
}
export function deleteTtSession(key: string): void {
  ttStore.delete(key);
}

export interface ThreadsMediaItem {
  type: "video" | "image";
  url: string;
}

export interface ThreadsSession {
  items: ThreadsMediaItem[];
  createdAt: number;
}

const thrStore = makeStore<ThreadsSession>();

export function saveThrSession(key: string, session: ThreadsSession): void {
  thrStore.save(key, session);
}
export function getThrSession(key: string): ThreadsSession | undefined {
  return thrStore.get(key);
}
export function deleteThrSession(key: string): void {
  thrStore.delete(key);
}

export function generateKey(chatId: number, userId: number): string {
  return `${chatId}_${userId}_${Date.now()}`;
}
