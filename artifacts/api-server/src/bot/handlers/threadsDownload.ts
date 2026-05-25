import { Context, InputFile, InlineKeyboard } from "grammy";
import { threads } from "btch-downloader";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { logger } from "../../lib/logger";
import {
  saveThrSession,
  getThrSession,
  deleteThrSession,
  generateKey,
  type ThreadsMediaItem,
} from "../session";

const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
const MAX_ITEMS = 10;

interface RawItem {
  type?: string;
  video?: string | string[];
  image?: string | string[];
  download?: string | string[];
  url?: string;
}

function pickFirstString(val: string | string[] | undefined): string | undefined {
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

function extractItems(result: unknown): ThreadsMediaItem[] {
  const items: ThreadsMediaItem[] = [];

  const parseOne = (raw: RawItem): ThreadsMediaItem | null => {
    const isVideo = raw.type === "video";

    // Prefer the proxy download URL (avoids CDN 403), fall back to direct URL
    const downloadUrl = pickFirstString(raw.download);
    const directUrl = isVideo
      ? pickFirstString(raw.video)
      : pickFirstString(raw.image) ?? pickFirstString(raw.video);
    const url = downloadUrl ?? directUrl ?? pickFirstString(raw.video) ?? pickFirstString(raw.image);

    if (!url) return null;
    return { type: isVideo ? "video" : "image", url };
  };

  if (Array.isArray(result)) {
    for (const raw of result as RawItem[]) {
      const item = parseOne(raw);
      if (item) items.push(item);
    }
  } else if (result && typeof result === "object") {
    const item = parseOne(result as RawItem);
    if (item) items.push(item);
  }

  return items.slice(0, MAX_ITEMS);
}

function buildCarouselKeyboard(sessionKey: string, count: number): InlineKeyboard {
  const kb = new InlineKeyboard();

  kb.text("📥 Download Semua", `thr:${sessionKey}:all`);
  kb.row();

  const COLS = 5;
  for (let i = 0; i < count; i++) {
    kb.text(`${NUMBER_EMOJIS[i] ?? `#${i + 1}`}`, `thr:${sessionKey}:${i}`);
    if ((i + 1) % COLS === 0 && i + 1 < count) kb.row();
  }

  kb.row();
  kb.text("❌ Batal", `thr:${sessionKey}:cancel`);
  return kb;
}

export async function handleThreadsDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil media Threads, harap tunggu...");
  const chatId = ctx.chat!.id;

  try {
    const response = await threads(url);

    if (!response.status || !response.result) {
      const reason = (response as { message?: string }).message ?? "Tidak ada media yang ditemukan.";
      throw new Error(reason);
    }

    const items = extractItems(response.result);

    if (items.length === 0) {
      throw new Error("Tidak ada media yang bisa diunduh dari postingan ini.");
    }

    if (items.length === 1) {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, "⬇️ Mengunduh media...");
      await sendSingleItem(ctx, items[0]!);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      return;
    }

    const sessionKey = generateKey(chatId, ctx.from?.id ?? 0);
    saveThrSession(sessionKey, { items, createdAt: Date.now() });

    const typeLabel = items.map((it, i) =>
      `${NUMBER_EMOJIS[i] ?? `#${i + 1}`} ${it.type === "video" ? "🎬 Video" : "🖼 Foto"}`
    ).join("\n");

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `🧵 *Threads — ${items.length} Media Ditemukan*\n\n${typeLabel}\n\nPilih media yang ingin diunduh:`,
      {
        parse_mode: "Markdown",
        reply_markup: buildCarouselKeyboard(sessionKey, items.length),
      },
    );
  } catch (err) {
    logger.error({ err, url }, "Threads download failed");
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";
    const userMsg =
      msg.toLowerCase().includes("private") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no results")
        ? "❌ *Gagal mengunduh.*\n\nPostingan ini mungkin privat atau sudah dihapus."
        : `❌ *Gagal mengunduh.*\n\nPastikan link Threads valid dan postingan bersifat publik.\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``;

    await ctx.api
      .editMessageText(chatId, statusMsg.message_id, userMsg, { parse_mode: "Markdown" })
      .catch(() => ctx.reply(userMsg, { parse_mode: "Markdown" }));
  }
}

export async function handleThreadsCallback(
  ctx: Context,
  sessionKey: string,
  choice: string,
) {
  const session = getThrSession(sessionKey);

  if (!session) {
    await ctx.answerCallbackQuery({ text: "⌛ Sesi sudah kedaluwarsa. Kirim link lagi." });
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  await ctx.answerCallbackQuery();

  if (choice === "cancel") {
    deleteThrSession(sessionKey);
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  if (choice === "all") {
    deleteThrSession(sessionKey);
    await ctx.editMessageText(
      `⬇️ Mengunduh semua *${session.items.length}* media...`,
      { parse_mode: "Markdown" },
    );

    let successCount = 0;
    for (let i = 0; i < session.items.length; i++) {
      const item = session.items[i]!;
      try {
        await sendSingleItem(ctx, item, `${i + 1}/${session.items.length}`);
        successCount++;
      } catch (err) {
        logger.error({ err, index: i }, "Threads download all: item failed");
        await ctx.reply(`❌ Media ke-${i + 1} gagal diunduh.`);
      }
    }

    await ctx.deleteMessage().catch(() => null);
    if (successCount > 0) {
      await ctx.reply(`✅ Selesai! ${successCount} dari ${session.items.length} media berhasil dikirim.`);
    }
    return;
  }

  const index = parseInt(choice, 10);
  if (isNaN(index) || index < 0 || index >= session.items.length) {
    await ctx.answerCallbackQuery({ text: "❌ Pilihan tidak valid." });
    return;
  }

  const item = session.items[index]!;
  const statusMsg = await ctx.reply(
    `⬇️ Mengunduh media ke-${index + 1}...`,
  );

  try {
    await sendSingleItem(ctx, item);
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => null);
  } catch (err) {
    logger.error({ err, index }, "Threads callback single download failed");
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ Gagal mengunduh media ke-${index + 1}.`,
    );
  }
}

async function sendSingleItem(ctx: Context, item: ThreadsMediaItem, label?: string) {
  const { filePath, fileSizeMB } = await downloadToTemp(item.url, item.type === "video");

  try {
    if (fileSizeMB > 50) {
      await ctx.reply(
        `❌ Media${label ? ` ke-${label}` : ""} terlalu besar (${fileSizeMB.toFixed(1)} MB), melebihi batas 50 MB Telegram.`,
      );
      return;
    }

    const caption = `🧵 *Threads*${label ? ` (${label})` : ""}`;

    if (item.type === "video") {
      await ctx.replyWithVideo(
        new InputFile(fs.createReadStream(filePath), "video.mp4"),
        { caption, parse_mode: "Markdown" },
      );
    } else {
      await ctx.replyWithPhoto(
        new InputFile(fs.createReadStream(filePath), "image.jpg"),
        { caption, parse_mode: "Markdown" },
      );
    }
  } finally {
    fs.unlink(filePath, () => null);
  }
}

async function downloadToTemp(
  url: string,
  isVideo: boolean,
): Promise<{ filePath: string; fileSizeMB: number }> {
  const ext = isVideo ? ".mp4" : ".jpg";
  const fileName = `threads_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://www.threads.com/",
      "Accept": "*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`Gagal mengunduh media (HTTP ${res.status})`);
  }

  const fileStream = fs.createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    if (!res.body) {
      reject(new Error("Response body kosong"));
      return;
    }
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(fileStream);
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
  });

  const stat = fs.statSync(filePath);
  return { filePath, fileSizeMB: stat.size / (1024 * 1024) };
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
