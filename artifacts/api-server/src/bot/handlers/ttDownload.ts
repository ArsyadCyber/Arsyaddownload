import { Context, InputFile, InlineKeyboard } from "grammy";
import { ttdl } from "btch-downloader";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { logger } from "../../lib/logger";
import { saveTtSession, getTtSession, deleteTtSession, generateKey } from "../session";

export async function handleTtDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil info TikTok, harap tunggu...");
  const chatId = ctx.chat!.id;

  try {
    const data = await ttdl(url);

    if (!data.status) {
      const reason = (data as { message?: string }).message ?? "Tidak ada media yang ditemukan.";
      throw new Error(reason);
    }

    const title = data.title ?? "TikTok Video";
    const videos = data.video ?? [];
    const audios = data.audio ?? [];

    if (videos.length === 0 && audios.length === 0) {
      throw new Error("Tidak ada link download yang tersedia.");
    }

    const sessionKey = generateKey(chatId, ctx.from!.id);
    saveTtSession(sessionKey, {
      title,
      videoWithWatermark: videos[0] ? [videos[0]] : [],
      videoNoWatermark: videos[1] ? [videos[1]] : videos[0] ? [videos[0]] : [],
      audio: audios,
      createdAt: Date.now(),
    });

    const keyboard = new InlineKeyboard();

    if (videos.length > 0) {
      keyboard.text("📹 Dengan Watermark", `tt:${sessionKey}:wm`);
    }
    if (videos[1] || videos[0]) {
      keyboard.text("✨ Tanpa Watermark", `tt:${sessionKey}:nwm`);
    }
    keyboard.row();
    if (audios.length > 0) {
      keyboard.text("🎵 Audio Only (MP3)", `tt:${sessionKey}:audio`);
      keyboard.row();
    }
    keyboard.text("❌ Batalkan", `tt:${sessionKey}:cancel`);

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `🎵 *TikTok*\n\n*Judul:* ${escapeMarkdown(title)}\n\nPilih format yang ingin diunduh:`,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  } catch (err) {
    logger.error({ err, url }, "TikTok info fetch failed");
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ *Gagal mengambil info video.*\n\nPastikan link TikTok valid.\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``,
      { parse_mode: "Markdown" },
    );
  }
}

export async function handleTtCallback(
  ctx: Context,
  sessionKey: string,
  choice: string,
) {
  await ctx.answerCallbackQuery({ text: "⬇️ Memulai download..." });

  const session = getTtSession(sessionKey);
  if (!session) {
    await ctx.reply("⚠️ Sesi telah kedaluwarsa. Kirim ulang link TikTok kamu.");
    return;
  }

  deleteTtSession(sessionKey);

  const chatId = ctx.chat!.id;
  let downloadUrl: string | undefined;
  let isAudio = false;
  let label = "";

  if (choice === "wm") {
    downloadUrl = session.videoWithWatermark[0];
    label = "Dengan Watermark";
  } else if (choice === "nwm") {
    downloadUrl = session.videoNoWatermark[0];
    label = "Tanpa Watermark";
  } else if (choice === "audio") {
    downloadUrl = session.audio[0];
    isAudio = true;
    label = "Audio Only";
  }

  if (!downloadUrl) {
    await ctx.reply("❌ Format yang dipilih tidak tersedia untuk video ini.");
    return;
  }

  const statusMsg = await ctx.reply(
    `⏳ Mengunduh *${escapeMarkdown(session.title)}*\n📦 Format: *${label}*\n\nHarap tunggu...`,
    { parse_mode: "Markdown" },
  );

  try {
    const { filePath, fileSizeMB } = await downloadToTemp(downloadUrl, isAudio);

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

      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `✅ Download selesai (${fileSizeMB.toFixed(1)} MB). Mengirim...`,
      );

      const caption = `🎵 *${escapeMarkdown(session.title)}*\n📦 ${label}`;

      if (isAudio) {
        await ctx.replyWithAudio(
          new InputFile(fs.createReadStream(filePath), "audio.mp3"),
          { caption, parse_mode: "Markdown" },
        );
      } else {
        await ctx.replyWithVideo(
          new InputFile(fs.createReadStream(filePath), "video.mp4"),
          { caption, parse_mode: "Markdown" },
        );
      }

      await ctx.api.deleteMessage(chatId, statusMsg.message_id);
    } finally {
      fs.unlink(filePath, () => null);
    }
  } catch (err) {
    logger.error({ err, choice }, "TikTok download failed");
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";
    await ctx.api
      .editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ *Gagal mengunduh.*\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``,
        { parse_mode: "Markdown" },
      )
      .catch(() => null);
  }
}

async function downloadToTemp(
  url: string,
  isAudio: boolean,
): Promise<{ filePath: string; fileSizeMB: number }> {
  const ext = isAudio ? ".mp3" : ".mp4";
  const fileName = `tt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Gagal mengunduh (HTTP ${res.status})`);
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
