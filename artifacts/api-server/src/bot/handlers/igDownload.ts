import { Context, InputFile, InputMediaBuilder } from "grammy";
import { igdl } from "btch-downloader";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { logger } from "../../lib/logger";

interface IgItem {
  thumbnail: string;
  url: string;
}

export async function handleIgDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply(
    "⏳ Mengambil media Instagram, harap tunggu...",
  );

  const chatId = ctx.chat!.id;

  try {
    const response = await igdl(url);

    if (!response.status || !response.result || response.result.length === 0) {
      const reason = (response as { message?: string }).message ?? "Tidak ada media yang ditemukan.";
      throw new Error(reason);
    }

    const items = response.result as IgItem[];
    const total = items.length;

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `📸 Ditemukan *${total} media*. Mengunduh dan mengirim...`,
      { parse_mode: "Markdown" },
    );

    if (total === 1) {
      const item = items[0]!;
      const filePath = await downloadToTemp(item.url);

      try {
        const isVideo = isVideoFile(filePath, item.url);
        if (isVideo) {
          await ctx.replyWithVideo(
            new InputFile(fs.createReadStream(filePath), "media.mp4"),
            { caption: "📹 Instagram Video" },
          );
        } else {
          await ctx.replyWithPhoto(
            new InputFile(fs.createReadStream(filePath), "media.jpg"),
            { caption: "📸 Instagram Photo" },
          );
        }
      } finally {
        fs.unlink(filePath, () => null);
      }
    } else {
      const chunks = chunkArray(items, 10);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci]!;
        const tempFiles: string[] = [];

        try {
          const mediaGroup = await Promise.all(
            chunk.map(async (item) => {
              const filePath = await downloadToTemp(item.url);
              tempFiles.push(filePath);
              const isVideo = isVideoFile(filePath, item.url);
              if (isVideo) {
                return InputMediaBuilder.video(
                  new InputFile(fs.createReadStream(filePath), "media.mp4"),
                );
              } else {
                return InputMediaBuilder.photo(
                  new InputFile(fs.createReadStream(filePath), "media.jpg"),
                );
              }
            }),
          );

          await ctx.replyWithMediaGroup(mediaGroup);
        } finally {
          for (const f of tempFiles) {
            fs.unlink(f, () => null);
          }
        }

        if (ci < chunks.length - 1) {
          await sleep(1000);
        }
      }
    }

    await ctx.api.deleteMessage(chatId, statusMsg.message_id);
  } catch (err) {
    logger.error({ err, url }, "Instagram download failed");

    const msg =
      err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";

    const isPrivate =
      msg.toLowerCase().includes("private") ||
      msg.toLowerCase().includes("login") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no results");

    const userMsg = isPrivate
      ? "❌ *Gagal mengunduh.*\n\nMedia ini bersifat privat atau akun perlu login untuk mengaksesnya."
      : `❌ *Gagal mengunduh.*\n\nPastikan link Instagram valid dan akun tidak privat.\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``;

    await ctx.api
      .editMessageText(chatId, statusMsg.message_id, userMsg, {
        parse_mode: "Markdown",
      })
      .catch(() => ctx.reply(userMsg, { parse_mode: "Markdown" }));
  }
}

async function downloadToTemp(url: string): Promise<string> {
  const ext = guessExtension(url);
  const fileName = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

  return filePath;
}

function isVideoFile(filePath: string, url: string): boolean {
  const lowerUrl = url.toLowerCase().split("?")[0] ?? "";
  if (lowerUrl.endsWith(".mp4") || lowerUrl.endsWith(".mov") || lowerUrl.endsWith(".webm")) {
    return true;
  }
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith(".mp4") || lowerPath.endsWith(".mov") || lowerPath.endsWith(".webm");
}

function guessExtension(url: string): string {
  const clean = url.toLowerCase().split("?")[0] ?? "";
  if (clean.endsWith(".mp4")) return ".mp4";
  if (clean.endsWith(".mov")) return ".mov";
  if (clean.endsWith(".webm")) return ".webm";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return ".jpg";
  if (clean.endsWith(".png")) return ".png";
  if (clean.includes("video")) return ".mp4";
  return ".jpg";
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
