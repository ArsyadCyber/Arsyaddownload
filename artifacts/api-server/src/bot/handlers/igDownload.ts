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

interface DownloadedMedia {
  filePath: string;
  isVideo: boolean;
}

export async function handleIgDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply(
    "⏳ Mengambil media Instagram, harap tunggu...",
  );

  const chatId = ctx.chat!.id;

  try {
    const response = await igdl(url);

    if (!response.status || !response.result || response.result.length === 0) {
      const reason =
        (response as { message?: string }).message ??
        "Tidak ada media yang ditemukan.";
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
      const media = await downloadToTemp(item.url);

      try {
        if (media.isVideo) {
          await ctx.replyWithVideo(
            new InputFile(fs.createReadStream(media.filePath), "media.mp4"),
            { caption: "📹 Instagram Video" },
          );
        } else {
          await ctx.replyWithPhoto(
            new InputFile(fs.createReadStream(media.filePath), "media.jpg"),
            { caption: "📸 Instagram Photo" },
          );
        }
      } finally {
        fs.unlink(media.filePath, () => null);
      }
    } else {
      const chunks = chunkArray(items, 10);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci]!;
        const downloaded: DownloadedMedia[] = [];

        try {
          for (const item of chunk) {
            const media = await downloadToTemp(item.url);
            downloaded.push(media);
          }

          const mediaGroup = downloaded.map((media) => {
            if (media.isVideo) {
              return InputMediaBuilder.video(
                new InputFile(
                  fs.createReadStream(media.filePath),
                  "media.mp4",
                ),
              );
            } else {
              return InputMediaBuilder.photo(
                new InputFile(
                  fs.createReadStream(media.filePath),
                  "media.jpg",
                ),
              );
            }
          });

          await ctx.replyWithMediaGroup(mediaGroup);
        } finally {
          for (const media of downloaded) {
            fs.unlink(media.filePath, () => null);
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

async function downloadToTemp(url: string): Promise<DownloadedMedia> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Gagal mengunduh media (HTTP ${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isVideo = contentType.startsWith("video/") || isVideoByUrl(url);
  const ext = isVideo ? ".mp4" : ".jpg";

  const fileName = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  const fileStream = fs.createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    if (!res.body) {
      reject(new Error("Response body kosong"));
      return;
    }
    Readable.fromWeb(
      res.body as Parameters<typeof Readable.fromWeb>[0],
    ).pipe(fileStream);
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
  });

  return { filePath, isVideo };
}

function isVideoByUrl(url: string): boolean {
  const clean = (url.toLowerCase().split("?")[0] ?? "");
  return (
    clean.endsWith(".mp4") ||
    clean.endsWith(".mov") ||
    clean.endsWith(".webm") ||
    clean.includes("/video/") ||
    clean.includes("video_dashinit")
  );
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
