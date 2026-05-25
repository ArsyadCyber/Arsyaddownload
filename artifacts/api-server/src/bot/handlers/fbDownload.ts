import { Context, InputFile, InlineKeyboard } from "grammy";
import { spawn } from "node:child_process";
import path from "node:path";
import { logger } from "../../lib/logger";
import {
  saveFbSession,
  getFbSession,
  deleteFbSession,
  generateKey,
  type FbMediaItem,
} from "../session";

const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

// __dirname is dist/ at runtime (esbuild banner), so go up one level to reach src/
const PYTHON_SCRIPT = path.resolve(
  __dirname,
  "../src/bot/utils/fbSnapsave.py",
);

interface SnapsaveResult {
  status?: "ok";
  error?: string;
  title?: string;
  thumbnail?: string;
  items?: Array<{ url: string; label: string; quality: string }>;
}

function runSnapsave(fbUrl: string): Promise<SnapsaveResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", [PYTHON_SCRIPT, fbUrl], {
      timeout: 40_000,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (stderr) logger.warn({ stderr }, "fbSnapsave stderr");
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ error: `Script error (exit ${code}): ${stderr.slice(0, 200)}` });
      }
    });

    child.on("error", (err) => {
      resolve({ error: `Failed to start downloader: ${err.message}` });
    });
  });
}

async function sendFbMedia(ctx: Context, item: FbMediaItem, label: string) {
  const { url } = item;
  const caption = `🎬 *Facebook Video* — ${label}`;

  try {
    // Try sending as video URL directly (Telegram resolves CDN links well)
    await ctx.replyWithVideo(url, {
      caption,
      parse_mode: "Markdown",
      supports_streaming: true,
    });
    return;
  } catch {
    // Fallback: stream via InputFile
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const { Readable } = await import("node:stream");
      const stream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
      await ctx.replyWithVideo(new InputFile(stream, "facebook_video.mp4"), {
        caption,
        parse_mode: "Markdown",
        supports_streaming: true,
      });
    } catch (err2) {
      logger.warn({ err: err2 }, "fbDownload stream failed, sending link");
      await ctx.reply(
        `🎬 *Facebook Video* — ${label}\n\n[⬇️ Download Link](${url})`,
        { parse_mode: "Markdown" },
      );
    }
  }
}

export async function handleFbDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil info video Facebook…");

  let result: SnapsaveResult;
  try {
    result = await runSnapsave(url);
  } catch (err) {
    logger.error({ err }, "fbDownload runSnapsave failed");
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Gagal menghubungi layanan download. Coba lagi nanti.",
    );
    return;
  }

  if (result.error || !result.items?.length) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ ${result.error ?? "Tidak ada link download ditemukan."}\n\n_Pastikan video bersifat publik._`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  const items = result.items;

  // Single item — send directly
  if (items.length === 1) {
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => null);
    const item = items[0]!;
    await sendFbMedia(ctx, { url: item.url, label: item.label }, item.label);
    return;
  }

  // Multiple qualities — show inline keyboard
  const sessionKey = generateKey(ctx.chat!.id, ctx.from!.id);
  saveFbSession(sessionKey, {
    items: items.map((i) => ({ url: i.url, label: i.label })),
    createdAt: Date.now(),
  });

  const keyboard = new InlineKeyboard();
  items.forEach((item, idx) => {
    const emoji = NUMBER_EMOJIS[idx] ?? `${idx + 1}.`;
    keyboard.text(`${emoji} ${item.label} (${item.quality || item.label})`, `fb:${sessionKey}:${idx}`);
    keyboard.row();
  });
  keyboard.text("❌ Batal", `fb:${sessionKey}:cancel`);

  const title = result.title ? `\n📝 *${result.title.slice(0, 60)}*` : "";
  await ctx.api.editMessageText(
    ctx.chat!.id,
    statusMsg.message_id,
    `🎬 *Facebook Video*${title}\n\nPilih kualitas video:`,
    { parse_mode: "Markdown", reply_markup: keyboard },
  );
}

export async function handleFbCallback(
  ctx: Context,
  sessionKey: string,
  choice: string,
) {
  if (choice === "cancel") {
    await ctx.answerCallbackQuery({ text: "❌ Dibatalkan." });
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  const session = getFbSession(sessionKey);
  if (!session) {
    await ctx.answerCallbackQuery({ text: "❌ Sesi sudah expired. Kirim ulang link." });
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  const idx = parseInt(choice, 10);
  const item = session.items[idx];
  if (!item) {
    await ctx.answerCallbackQuery({ text: "❌ Pilihan tidak valid." });
    return;
  }

  await ctx.answerCallbackQuery({ text: "⏳ Mengunduh…" });
  await ctx.deleteMessage().catch(() => null);
  deleteFbSession(sessionKey);

  await sendFbMedia(ctx, item, item.label);
}
