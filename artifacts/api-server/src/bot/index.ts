import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger";
import { handleYtDownload } from "./handlers/ytDownload";

const token = process.env["TELEGRAM_BOT_TOKEN"];

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");
}

export const bot = new Bot(token);

bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard().text("📥 YT Download", "yt_download");

  await ctx.reply(
    `Halo, *${ctx.from?.first_name ?? "Pengguna"}*! 👋\n\nSelamat datang di bot ini. Saya bisa membantu kamu mengunduh video dari YouTube.\n\nTekan tombol di bawah untuk memulai fitur download YouTube:`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    },
  );
});

bot.callbackQuery("yt_download", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "🔗 Kirimkan link YouTube yang ingin kamu download.\n\nContoh: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`",
    { parse_mode: "Markdown" },
  );
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  const youtubeRegex =
    /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

  if (youtubeRegex.test(text)) {
    await handleYtDownload(ctx, text);
    return;
  }

  await ctx.reply(
    "Kirimkan link YouTube yang valid, atau ketik /start untuk memulai.",
  );
});

bot.catch((err) => {
  logger.error({ err: err.error }, "Bot error");
});
