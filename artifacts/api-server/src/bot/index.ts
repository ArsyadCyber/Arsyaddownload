import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger";
import { handleYtDownload, handleResolutionCallback } from "./handlers/ytDownload";
import { handleIgDownload } from "./handlers/igDownload";

const token = process.env["TELEGRAM_BOT_TOKEN"];

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");
}

export const bot = new Bot(token);

const youtubeRegex =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

const instagramRegex =
  /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[\w-]+/i;

bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("▶️ YT Download", "yt_download")
    .text("📸 IG Download", "ig_download");

  await ctx.reply(
    `Halo, *${ctx.from?.first_name ?? "Pengguna"}*! 👋\n\n` +
      `Selamat datang\\! Saya bisa membantu kamu mengunduh media dari:\n\n` +
      `▶️ *YouTube* — Video dengan pilihan resolusi\n` +
      `📸 *Instagram* — Reels, Post, Foto, Carousel\n\n` +
      `Pilih fitur di bawah atau langsung kirim link\\!`,
    {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    },
  );
});

bot.callbackQuery("yt_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "▶️ *YouTube Download*\n\nKirimkan link YouTube yang ingin kamu download.\n\nContoh:\n`https://www.youtube.com/watch?v=dQw4w9WgXcQ`\n`https://youtu.be/dQw4w9WgXcQ`",
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery("ig_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "📸 *Instagram Download*\n\nKirimkan link Instagram yang ingin kamu download.\n\nFormat yang didukung:\n• `https://www.instagram.com/p/xxxxx/`\n• `https://www.instagram.com/reel/xxxxx/`\n• `https://www.instagram.com/stories/user/xxxxx/`",
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

  await ctx.reply(
    "Kirimkan link YouTube atau Instagram yang valid, atau ketik /start untuk melihat menu.",
  );
});

bot.catch((err) => {
  logger.error({ err: err.error }, "Bot error");
});
