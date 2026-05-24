import { Context, InputFile } from "grammy";
import { threads } from "btch-downloader";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { logger } from "../../lib/logger";

interface ThreadsResult {
  status: boolean;
  type: "image" | "video";
  image: string;
  video?: string;
}

export async function handleThreadsDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil media Threads, harap tunggu...");
  const chatId = ctx.chat!.id;

  try {
    const response = await threads(url);

    if (!response.status || !response.result) {
      const reason =
        (response as { message?: string }).message ??
        "Tidak ada media yang ditemukan.";
      throw new Error(reason);
    }

    const result = response.result as unknown as ThreadsResult;
    const isVideo = result.type === "video" && !!result.video;
    const mediaUrl = isVideo ? result.video! : result.image;

    if (!mediaUrl) {
      throw new Error("URL media tidak tersedia.");
    }

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `${isVideo ? "🎬" : "🖼"} Mengunduh dan mengirim media...`,
    );

    const { filePath, fileSizeMB } = await downloadToTemp(mediaUrl, isVideo);

    try {
      if (fileSizeMB > 50) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `❌ *File terlalu besar!*\n\nUkuran (${fileSizeMB.toFixed(1)} MB) melebihi batas 50 MB Telegram.`,
          { parse_mode: "Markdown" },
        );
        return;
      }

      const caption = `${isVideo ? "🎬" : "🖼"} *Threads*`;

      if (isVideo) {
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

      await ctx.api.deleteMessage(chatId, statusMsg.message_id);
    } finally {
      fs.unlink(filePath, () => null);
    }
  } catch (err) {
    logger.error({ err, url }, "Threads download failed");
    const msg =
      err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";

    const userMsg =
      msg.toLowerCase().includes("private") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no results")
        ? "❌ *Gagal mengunduh.*\n\nPostingan ini mungkin privat atau sudah dihapus."
        : `❌ *Gagal mengunduh.*\n\nPastikan link Threads valid dan postingan bersifat publik.\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``;

    await ctx.api
      .editMessageText(chatId, statusMsg.message_id, userMsg, {
        parse_mode: "Markdown",
      })
      .catch(() => ctx.reply(userMsg, { parse_mode: "Markdown" }));
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

  const stat = fs.statSync(filePath);
  return { filePath, fileSizeMB: stat.size / (1024 * 1024) };
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
