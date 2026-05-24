import { Context, InputFile } from "grammy";
import youtubeDl from "youtube-dl-exec";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { logger } from "../../lib/logger";

export async function handleYtDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil info video, harap tunggu...");

  try {
    const info = await youtubeDl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });

    const videoInfo = info as {
      title?: string;
      uploader?: string;
      duration?: number;
      view_count?: number;
      thumbnail?: string;
      filesize_approx?: number;
    };

    const title = videoInfo.title ?? "Tidak diketahui";
    const uploader = videoInfo.uploader ?? "Tidak diketahui";
    const duration = videoInfo.duration
      ? formatDuration(videoInfo.duration)
      : "Tidak diketahui";
    const views = videoInfo.view_count
      ? videoInfo.view_count.toLocaleString("id-ID")
      : "Tidak diketahui";

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `📹 *Info Video*\n\n` +
        `*Judul:* ${escapeMarkdown(title)}\n` +
        `*Channel:* ${escapeMarkdown(uploader)}\n` +
        `*Durasi:* ${duration}\n` +
        `*Ditonton:* ${views} kali\n\n` +
        `⬇️ Mengunduh video... Harap tunggu.`,
      { parse_mode: "Markdown" },
    );

    const tmpDir = os.tmpdir();
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");

    await youtubeDl(url, {
      output: outputTemplate,
      format: "bestvideo[ext=mp4][filesize<50M]+bestaudio[ext=m4a]/best[ext=mp4][filesize<50M]/best[filesize<50M]",
      noWarnings: true,
      mergeOutputFormat: "mp4",
    });

    const files = fs.readdirSync(tmpDir).filter((f) => {
      const fullPath = path.join(tmpDir, f);
      const stat = fs.statSync(fullPath);
      const ageMs = Date.now() - stat.mtimeMs;
      return (
        (f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv")) &&
        ageMs < 60_000
      );
    });

    if (files.length === 0) {
      throw new Error("File hasil download tidak ditemukan.");
    }

    const filePath = path.join(tmpDir, files[0]!);
    const stat = fs.statSync(filePath);
    const fileSizeMB = stat.size / (1024 * 1024);

    if (fileSizeMB > 50) {
      fs.unlinkSync(filePath);
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ *Video terlalu besar!*\n\nUkuran video (${fileSizeMB.toFixed(1)} MB) melebihi batas 50 MB yang diizinkan Telegram.\n\nCoba video yang lebih pendek.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `✅ Download selesai (${fileSizeMB.toFixed(1)} MB). Mengirim video...`,
    );

    await ctx.replyWithVideo(
      new InputFile(fs.createReadStream(filePath), path.basename(filePath)),
      {
        caption: `🎬 *${escapeMarkdown(title)}*\n📺 ${escapeMarkdown(uploader)}`,
        parse_mode: "Markdown",
      },
    );

    fs.unlinkSync(filePath);

    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
  } catch (err) {
    logger.error({ err, url }, "YouTube download failed");

    const errorMessage =
      err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";

    const isAgeRestricted =
      errorMessage.toLowerCase().includes("age") ||
      errorMessage.toLowerCase().includes("sign in");
    const isPrivate =
      errorMessage.toLowerCase().includes("private") ||
      errorMessage.toLowerCase().includes("unavailable");

    let userMessage = `❌ *Gagal mengunduh video.*\n\n`;

    if (isAgeRestricted) {
      userMessage += "Video ini memiliki batasan usia dan tidak bisa diunduh.";
    } else if (isPrivate) {
      userMessage +=
        "Video ini bersifat privat atau tidak tersedia di wilayah ini.";
    } else {
      userMessage +=
        "Pastikan link yang kamu kirim valid dan video tersedia untuk umum.\n\n" +
        `Detail: \`${escapeMarkdown(errorMessage.slice(0, 200))}\``;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      userMessage,
      { parse_mode: "Markdown" },
    );
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
