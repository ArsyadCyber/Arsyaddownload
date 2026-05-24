import { Context, InputFile, InlineKeyboard } from "grammy";
import youtubeDl from "youtube-dl-exec";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { logger } from "../../lib/logger";
import {
  saveSession,
  getSession,
  deleteSession,
  generateKey,
  type Resolution,
} from "../session";

interface YtFormat {
  format_id: string;
  ext: string;
  height?: number | null;
  vcodec?: string;
  acodec?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
}

interface YtInfo {
  title?: string;
  uploader?: string;
  duration?: number;
  view_count?: number;
  formats?: YtFormat[];
}

export async function handleYtDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil info video, harap tunggu...");

  try {
    const raw = await youtubeDl(url, {
      dumpSingleJson: true,
      noWarnings: true,
    });

    const info = raw as YtInfo;

    const title = info.title ?? "Tidak diketahui";
    const uploader = info.uploader ?? "Tidak diketahui";
    const duration = info.duration
      ? formatDuration(info.duration)
      : "Tidak diketahui";
    const views = info.view_count
      ? info.view_count.toLocaleString("id-ID")
      : "Tidak diketahui";

    const resolutions = buildResolutions(info.formats ?? []);

    if (resolutions.length === 0) {
      throw new Error("Tidak ada format video yang tersedia untuk diunduh.");
    }

    const chatId = ctx.chat!.id;
    const userId = ctx.from!.id;
    const sessionKey = generateKey(chatId, userId);

    saveSession(sessionKey, {
      url,
      title,
      uploader,
      duration,
      resolutions,
      createdAt: Date.now(),
    });

    const keyboard = buildResolutionKeyboard(resolutions, sessionKey);

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `📹 *${escapeMarkdown(title)}*\n\n` +
        `📺 *Channel:* ${escapeMarkdown(uploader)}\n` +
        `⏱ *Durasi:* ${duration}\n` +
        `👁 *Ditonton:* ${views} kali\n\n` +
        `🎚 Pilih resolusi yang ingin diunduh:`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      },
    );
  } catch (err) {
    logger.error({ err, url }, "YouTube info fetch failed");
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      buildErrorMessage(err),
      { parse_mode: "Markdown" },
    );
  }
}

export async function handleResolutionCallback(
  ctx: Context,
  sessionKey: string,
  formatId: string,
) {
  await ctx.answerCallbackQuery({ text: "⬇️ Memulai download..." });

  const session = getSession(sessionKey);
  if (!session) {
    await ctx.reply(
      "⚠️ Sesi telah kedaluwarsa. Kirim ulang link YouTube kamu.",
    );
    return;
  }

  const resolution = session.resolutions.find((r) => r.formatId === formatId);
  const resLabel = resolution?.label ?? formatId;

  const chatId = ctx.chat!.id;

  const statusMsg = await ctx.reply(
    `⏳ Mengunduh *${escapeMarkdown(session.title)}*\n` +
      `📐 Resolusi: *${resLabel}*\n\nHarap tunggu...`,
    { parse_mode: "Markdown" },
  );

  deleteSession(sessionKey);

  try {
    const tmpDir = os.tmpdir();
    const fileId = `yt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outputTemplate = path.join(tmpDir, `${fileId}.%(ext)s`);

    const isAudioOnly = resolution?.audioOnly === true;

    if (isAudioOnly) {
      await youtubeDl(session.url, {
        output: outputTemplate,
        format: "bestaudio/best",
        noWarnings: true,
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
      });
    } else {
      const h = resolution?.height;
      const format =
        formatId === "best" || !h
          ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
          : `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/best[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${h}]`;

      await youtubeDl(session.url, {
        output: outputTemplate,
        format,
        noWarnings: true,
        mergeOutputFormat: "mp4",
      });
    }

    const ext = isAudioOnly ? ".mp3" : ".mp4";
    const candidates = fs.readdirSync(tmpDir).filter((f) => {
      return f.startsWith(fileId) && (f.endsWith(".mp4") || f.endsWith(".mp3") || f.endsWith(".webm") || f.endsWith(".mkv") || f.endsWith(".m4a"));
    });

    if (candidates.length === 0) {
      throw new Error("File hasil download tidak ditemukan.");
    }

    const filePath = path.join(tmpDir, candidates[0]!);
    const stat = fs.statSync(filePath);
    const fileSizeMB = stat.size / (1024 * 1024);

    if (fileSizeMB > 50) {
      fs.unlinkSync(filePath);
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ *Video terlalu besar\\!*\n\nUkuran \\(${fileSizeMB.toFixed(1)} MB\\) melebihi batas 50 MB Telegram\\.\n\nCoba pilih resolusi yang lebih rendah\\.`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `✅ Download selesai \\(${fileSizeMB.toFixed(1)} MB\\)\\. Mengirim\\.\\.\\.`,
      { parse_mode: "MarkdownV2" },
    );

    const caption =
      `🎬 *${escapeMarkdown(session.title)}*\n` +
      `📺 ${escapeMarkdown(session.uploader)}\n` +
      `📐 ${escapeMarkdown(resLabel)}`;

    if (isAudioOnly) {
      await ctx.replyWithAudio(
        new InputFile(fs.createReadStream(filePath), `audio${ext}`),
        { caption, parse_mode: "Markdown" },
      );
    } else {
      await ctx.replyWithVideo(
        new InputFile(fs.createReadStream(filePath), `video${ext}`),
        { caption, parse_mode: "Markdown" },
      );
    }

    fs.unlinkSync(filePath);
    await ctx.api.deleteMessage(chatId, statusMsg.message_id);
  } catch (err) {
    logger.error({ err, url: session.url }, "YouTube download failed");
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      buildErrorMessage(err),
      { parse_mode: "Markdown" },
    );
  }
}

function buildResolutions(formats: YtFormat[]): Resolution[] {
  const seen = new Set<string>();
  const result: Resolution[] = [];

  const availableHeights = new Set(
    formats
      .filter((f) => f.vcodec && f.vcodec !== "none" && f.height && f.height > 0)
      .map((f) => f.height as number),
  );

  const targetHeights = [2160, 1440, 1080, 720, 480, 360, 240, 144];

  for (const targetHeight of targetHeights) {
    if (availableHeights.has(targetHeight) && !seen.has(String(targetHeight))) {
      seen.add(String(targetHeight));
      const label =
        targetHeight >= 2160
          ? `4K (${targetHeight}p)`
          : targetHeight >= 1440
            ? `2K (${targetHeight}p)`
            : `${targetHeight}p`;
      result.push({
        label,
        formatId: String(targetHeight),
        height: targetHeight,
        audioOnly: false,
      });
    }
  }

  if (result.length === 0) {
    result.push({
      label: "Kualitas terbaik",
      formatId: "best",
      height: null,
      audioOnly: false,
    });
  }

  result.push({
    label: "🎵 Audio Only (MP3)",
    formatId: "audio",
    height: null,
    audioOnly: true,
  });

  return result;
}

function buildResolutionKeyboard(
  resolutions: Resolution[],
  sessionKey: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const videoRes = resolutions.filter((r) => !r.audioOnly);
  const audioRes = resolutions.filter((r) => r.audioOnly);

  const itemsPerRow = 3;
  for (let i = 0; i < videoRes.length; i++) {
    const res = videoRes[i]!;
    keyboard.text(res.label, `res:${sessionKey}:${res.formatId}`);
    if ((i + 1) % itemsPerRow === 0 || i === videoRes.length - 1) {
      keyboard.row();
    }
  }

  for (const res of audioRes) {
    keyboard.text(res.label, `res:${sessionKey}:${res.formatId}`);
    keyboard.row();
  }

  keyboard.text("❌ Batalkan", `res:${sessionKey}:cancel`);

  return keyboard;
}

function buildErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";
  const lower = msg.toLowerCase();

  const isAgeRestricted =
    lower.includes("age-restricted") ||
    lower.includes("age restricted") ||
    lower.includes("confirm your age") ||
    lower.includes("age limit") ||
    lower.includes("age verification") ||
    (lower.includes("sign in") && lower.includes("age"));

  const isPrivate =
    lower.includes("private video") ||
    lower.includes("video unavailable") ||
    lower.includes("video is unavailable") ||
    lower.includes("has been removed") ||
    lower.includes("account has been terminated");

  if (isAgeRestricted) {
    return "❌ *Gagal mengunduh.*\n\nVideo ini memiliki batasan usia dan tidak bisa diunduh.";
  }
  if (isPrivate) {
    return "❌ *Gagal mengunduh.*\n\nVideo ini bersifat privat atau tidak tersedia di wilayah ini.";
  }

  return (
    `❌ *Gagal mengunduh.*\n\n` +
    `Pastikan link valid dan video tersedia untuk umum.\n\n` +
    `Detail: \`${escapeMarkdown(msg.slice(0, 200))}\``
  );
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
