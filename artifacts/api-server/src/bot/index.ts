import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger";
import { handleYtDownload, handleResolutionCallback } from "./handlers/ytDownload";
import { handleIgDownload } from "./handlers/igDownload";
import { handleTtDownload, handleTtCallback } from "./handlers/ttDownload";
import { handleThreadsDownload, handleThreadsCallback } from "./handlers/threadsDownload";
import { handleFbDownload, handleFbCallback } from "./handlers/fbDownload";

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");
}

export const bot = new Bot(token);

const youtubeRegex =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

const instagramRegex =
  /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[\w-]+/i;

const tiktokRegex =
  /^(https?:\/\/)?(www\.|vm\.|vt\.|m\.)?tiktok\.com\/([@\w.-]+\/video\/\d+|v\/\d+|[\w-]+\/?)/i;

const threadsRegex =
  /^(https?:\/\/)?(www\.)?threads\.(net|com)\/@[\w.-]+\/post\/[\w-]+/i;

const facebookRegex =
  /^(https?:\/\/)?(www\.|m\.|web\.)?facebook\.com\/(reel\/\d+|watch\/?\?v=\d+|[\w.]+\/videos\/\d+|[\w.]+\/reels\/\d+|share\/(v|r)\/[\w-]+|video\/embed\?video_id=\d+)/i;

bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("▶️ YouTube", "yt_download")
    .text("📸 Instagram", "ig_download")
    .row()
    .text("🎵 TikTok", "tt_download")
    .text("🧵 Threads", "threads_download")
    .row()
    .text("📘 Facebook", "fb_download");

  await ctx.reply(
    `Halo, *${ctx.from?.first_name ?? "Pengguna"}*\\! 👋\n\n` +
      `Selamat datang\\! Saya bisa membantu kamu mengunduh media dari:\n\n` +
      `▶️ *YouTube* — Video dengan pilihan resolusi\n` +
      `📸 *Instagram* — Reels, Post, Foto, Carousel\n` +
      `🎵 *TikTok* — Video dengan/tanpa watermark \\+ Audio\n` +
      `🧵 *Threads* — Video & Foto dari postingan\n` +
      `📘 *Facebook* — Reels, Post, & Video publik\n\n` +
      `Pilih platform di bawah atau langsung kirim link\\!`,
    { parse_mode: "MarkdownV2", reply_markup: keyboard },
  );
});

bot.callbackQuery("yt_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "▶️ *YouTube Download*\n\nKirimkan link YouTube.\n\nContoh:\n`https://www.youtube.com/watch?v=...`\n`https://youtu.be/...`",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("ig_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "📸 *Instagram Download*\n\nKirimkan link Instagram.\n\nFormat yang didukung:\n• `https://www.instagram.com/p/xxxxx/`\n• `https://www.instagram.com/reel/xxxxx/`\n• `https://www.instagram.com/stories/user/xxxxx/`",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("tt_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "🎵 *TikTok Download*\n\nKirimkan link TikTok.\n\nContoh:\n`https://www.tiktok.com/@user/video/123...`\n`https://vm.tiktok.com/xxxxx/`",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("threads_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "🧵 *Threads Download*\n\nKirimkan link postingan Threads.\n\nContoh:\n`https://www.threads.net/@user/post/xxxxx`",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("fb_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "📘 *Facebook Download*\n\nKirimkan link video Facebook (publik).\n\nFormat yang didukung:\n• `https://www.facebook.com/reel/12345...`\n• `https://www.facebook.com/watch?v=12345...`\n• `https://www.facebook.com/user/videos/12345...`\n\n⚠️ Hanya video publik yang dapat diunduh.",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery(/^res:(.+):(.+)$/, async (ctx) => {
  const [, sessionKey, formatId] = ctx.match;
  if (!sessionKey || !formatId) {
    await ctx.answerCallbackQuery({ text: "❌ Data tidak valid." });
    return;
  }
  if (formatId === "cancel") {
    await ctx.answerCallbackQuery({ text: "❌ Dibatalkan." });
    await ctx.deleteMessage().catch(() => null);
    return;
  }
  await handleResolutionCallback(ctx, sessionKey, formatId);
});

bot.callbackQuery(/^tt:(.+):(wm|nwm|audio|cancel)$/, async (ctx) => {
  const [, sessionKey, choice] = ctx.match;
  if (!sessionKey || !choice) {
    await ctx.answerCallbackQuery({ text: "❌ Data tidak valid." });
    return;
  }
  if (choice === "cancel") {
    await ctx.answerCallbackQuery({ text: "❌ Dibatalkan." });
    await ctx.deleteMessage().catch(() => null);
    return;
  }
  await handleTtCallback(ctx, sessionKey, choice);
});

bot.callbackQuery(/^thr:(.+):(all|cancel|\d+)$/, async (ctx) => {
  const [, sessionKey, choice] = ctx.match;
  if (!sessionKey || !choice) {
    await ctx.answerCallbackQuery({ text: "❌ Data tidak valid." });
    return;
  }
  await handleThreadsCallback(ctx, sessionKey, choice);
});

bot.callbackQuery(/^fb:(.+):(cancel|\d+)$/, async (ctx) => {
  const [, sessionKey, choice] = ctx.match;
  if (!sessionKey || !choice) {
    await ctx.answerCallbackQuery({ text: "❌ Data tidak valid." });
    return;
  }
  await handleFbCallback(ctx, sessionKey, choice);
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (youtubeRegex.test(text)) {
    await handleYtDownload(ctx, text);
    return;
  }
  if (instagramRegex.test(text)) {
    await handleIgDownload(ctx, text);
    return;
  }
  if (tiktokRegex.test(text)) {
    await handleTtDownload(ctx, text);
    return;
  }
  if (threadsRegex.test(text)) {
    await handleThreadsDownload(ctx, text);
    return;
  }
  if (facebookRegex.test(text)) {
    await handleFbDownload(ctx, text);
    return;
  }

  await ctx.reply(
    "Kirimkan link YouTube, Instagram, TikTok, Threads, atau Facebook yang valid — atau ketik /start untuk melihat menu.",
  );
});

bot.catch((err) => {
  logger.error({ err: err.error }, "Bot error");
});
