import { Context, InputFile, InlineKeyboard } from "grammy";
import { threads } from "btch-downloader";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { logger } from "../../lib/logger";
import {
  saveThrSession,
  getThrSession,
  deleteThrSession,
  generateKey,
  type ThreadsMediaItem,
} from "../session";

const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
const GOOGLEBOT_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── HTML entity decoder ──────────────────────────────────────────────────────
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ─── Parse embed page for all carousel media ──────────────────────────────────
interface EmbedMedia {
  type: "video" | "image";
  cdnUrl: string;
  vsKey: string;   // unique ID (vs= param or path fragment)
  priority: number; // lower = higher resolution
}

async function fetchEmbedMedia(postUrl: string): Promise<EmbedMedia[]> {
  // normalise: strip query string, ensure no trailing slash before /embed/
  const base = postUrl.replace(/\?.*/, "").replace(/\/$/, "");
  const embedUrl = `${base}/embed/`;

  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent": GOOGLEBOT_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) return [];

  const html = await res.text();
  const results: EmbedMedia[] = [];

  // ── Videos: every <source src="..."> inside a MediaScrollImageContainer
  const containerRe =
    /<div class="MediaScrollImageContainer">([\s\S]*?)<\/div>/g;
  let containerMatch: RegExpExecArray | null;
  let containerIdx = 0;

  while ((containerMatch = containerRe.exec(html)) !== null) {
    containerIdx++;
    const block = containerMatch[1];

    // Try video <source>
    const srcMatch = block.match(/<source src="([^"]+)"/);
    if (srcMatch) {
      const cdnUrl = decodeHtmlEntities(srcMatch[1]);
      const vsMatch = cdnUrl.match(/vs=([^&]+)/);
      const pathMatch = cdnUrl.match(/m84\/([A-Za-z0-9_-]{20,})/);
      const resMatch = cdnUrl.match(/unknown-C\d+\.(\d+)\./);
      const res = resMatch ? parseInt(resMatch[1], 10) : 0;

      const vsKey = vsMatch?.[1] ?? pathMatch?.[1] ?? String(containerIdx);

      results.push({
        type: "video",
        cdnUrl,
        vsKey,
        priority: res > 0 ? 10000 - res : containerIdx,
      });
      continue;
    }

    // Try image <img src>
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
    if (imgMatch) {
      const cdnUrl = decodeHtmlEntities(imgMatch[1]);
      const pathMatch = cdnUrl.match(/\/(v\/t51\.[^?]+|[A-Za-z0-9_-]{30,})\?/);
      const vsKey = pathMatch?.[1] ?? String(containerIdx);
      results.push({ type: "image", cdnUrl, vsKey, priority: containerIdx });
    }
  }

  // Deduplicate: for the same vsKey keep the highest resolution (lowest priority number)
  const best = new Map<string, EmbedMedia>();
  for (const m of results) {
    const existing = best.get(m.vsKey);
    if (!existing || m.priority < existing.priority) {
      best.set(m.vsKey, m);
    }
  }

  return [...best.values()];
}

// ─── Build carousel items from embed + btch-downloader ───────────────────────
async function buildCarouselItems(
  postUrl: string,
): Promise<ThreadsMediaItem[]> {
  // Call btch-downloader to get one item with a working proxy download URL
  const btchRes = await threads(postUrl).catch(() => null);
  const btchResult = btchRes?.status
    ? (btchRes.result as Record<string, unknown> | undefined)
    : undefined;

  // btch-dl "download" proxy URL (works without CDN restriction)
  const btchProxyUrl =
    typeof btchResult?.["download"] === "string"
      ? (btchResult["download"] as string)
      : undefined;
  // extract the CDN path fragment btch-dl used to correlate with embed items
  const btchVideoCdn =
    typeof btchResult?.["video"] === "string"
      ? (btchResult["video"] as string)
      : undefined;
  const btchPathFrag = btchVideoCdn?.match(/m84\/([A-Za-z0-9_-]{20,})/)?.[1];

  // Fetch ALL carousel items from embed page
  const embedItems = await fetchEmbedMedia(postUrl);

  if (embedItems.length === 0) {
    // Fallback: use btch-downloader result only
    if (!btchResult) return [];
    const isVideo =
      btchResult["type"] === "video" && !!btchResult["video"];
    const url = btchProxyUrl ?? (
      isVideo
        ? String(btchResult["video"] ?? "")
        : String(btchResult["image"] ?? btchResult["video"] ?? "")
    );
    if (!url) return [];
    return [{ type: isVideo ? "video" : "image", url }];
  }

  // Map embed items → ThreadsMediaItem, using btch proxy URL where possible
  return embedItems.map((em) => {
    // If embed CDN path matches btch-dl CDN path → use proxy URL (reliable download)
    const emPathFrag = em.cdnUrl.match(/m84\/([A-Za-z0-9_-]{20,})/)?.[1];
    const isMatchingBtch =
      btchPathFrag &&
      emPathFrag &&
      btchPathFrag.slice(0, 20) === emPathFrag.slice(0, 20);

    const url = isMatchingBtch && btchProxyUrl ? btchProxyUrl : em.cdnUrl;
    return { type: em.type, url };
  });
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
function buildCarouselKeyboard(
  sessionKey: string,
  count: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("📥 Download Semua", `thr:${sessionKey}:all`);
  kb.row();

  const COLS = 5;
  for (let i = 0; i < count; i++) {
    kb.text(NUMBER_EMOJIS[i] ?? `#${i + 1}`, `thr:${sessionKey}:${i}`);
    if ((i + 1) % COLS === 0 && i + 1 < count) kb.row();
  }

  kb.row().text("❌ Batal", `thr:${sessionKey}:cancel`);
  return kb;
}

// ─── Public handlers ──────────────────────────────────────────────────────────
export async function handleThreadsDownload(ctx: Context, url: string) {
  const statusMsg = await ctx.reply("⏳ Mengambil media Threads, harap tunggu...");
  const chatId = ctx.chat!.id;

  try {
    const items = await buildCarouselItems(url);

    if (items.length === 0) {
      throw new Error(
        "Tidak ada media yang dapat diunduh. Postingan mungkin privat atau API tidak mendukung.",
      );
    }

    if (items.length === 1) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "⬇️ Mengunduh media...",
      );
      await sendOneItem(ctx, items[0]!);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      return;
    }

    const sessionKey = generateKey(chatId, ctx.from?.id ?? 0);
    saveThrSession(sessionKey, { items, createdAt: Date.now() });

    const typeLabel = items
      .map(
        (it, i) =>
          `${NUMBER_EMOJIS[i] ?? `#${i + 1}`} ${it.type === "video" ? "🎬 Video" : "🖼 Foto"}`,
      )
      .join("\n");

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `🧵 *Threads — ${items.length} Media Ditemukan*\n\n${typeLabel}\n\nPilih media yang ingin diunduh:`,
      {
        parse_mode: "Markdown",
        reply_markup: buildCarouselKeyboard(sessionKey, items.length),
      },
    );
  } catch (err) {
    logger.error({ err, url }, "Threads download failed");
    const msg =
      err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.";
    const userMsg =
      msg.toLowerCase().includes("private") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("tidak ada")
        ? `❌ *Gagal mengunduh.*\n\n${msg}`
        : `❌ *Gagal mengunduh.*\n\nPastikan link Threads valid dan postingan publik.\n\nDetail: \`${escapeMarkdown(msg.slice(0, 200))}\``;

    await ctx.api
      .editMessageText(chatId, statusMsg.message_id, userMsg, {
        parse_mode: "Markdown",
      })
      .catch(() => ctx.reply(userMsg, { parse_mode: "Markdown" }));
  }
}

export async function handleThreadsCallback(
  ctx: Context,
  sessionKey: string,
  choice: string,
) {
  const session = getThrSession(sessionKey);

  if (!session) {
    await ctx.answerCallbackQuery({
      text: "⌛ Sesi sudah kedaluwarsa. Kirim link lagi.",
    });
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  await ctx.answerCallbackQuery();

  if (choice === "cancel") {
    deleteThrSession(sessionKey);
    await ctx.deleteMessage().catch(() => null);
    return;
  }

  if (choice === "all") {
    deleteThrSession(sessionKey);
    await ctx.editMessageText(
      `⬇️ Mengunduh semua *${session.items.length}* media...`,
      { parse_mode: "Markdown" },
    );

    let ok = 0;
    for (let i = 0; i < session.items.length; i++) {
      try {
        await sendOneItem(ctx, session.items[i]!, `${i + 1}/${session.items.length}`);
        ok++;
      } catch (err) {
        logger.error({ err, index: i }, "Threads all: item failed");
        await ctx.reply(`❌ Media ke-${i + 1} gagal diunduh.`);
      }
    }

    await ctx.deleteMessage().catch(() => null);
    if (ok > 0) {
      await ctx.reply(
        `✅ Selesai! ${ok} dari ${session.items.length} media berhasil dikirim.`,
      );
    }
    return;
  }

  const index = parseInt(choice, 10);
  if (isNaN(index) || index < 0 || index >= session.items.length) {
    await ctx.answerCallbackQuery({ text: "❌ Pilihan tidak valid." });
    return;
  }

  const statusMsg = await ctx.reply(`⬇️ Mengunduh media ke-${index + 1}...`);
  try {
    await sendOneItem(ctx, session.items[index]!);
    await ctx.api
      .deleteMessage(ctx.chat!.id, statusMsg.message_id)
      .catch(() => null);
  } catch (err) {
    logger.error({ err, index }, "Threads single callback failed");
    await ctx.api
      .editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ Gagal mengunduh media ke-${index + 1}.`,
      )
      .catch(() => null);
  }
}

// ─── Send one media item ──────────────────────────────────────────────────────
async function sendOneItem(
  ctx: Context,
  item: ThreadsMediaItem,
  label?: string,
) {
  const caption = `🧵 *Threads*${label ? ` (${label})` : ""}`;

  // Strategy 1: download to temp file and upload (works for proxy URLs)
  try {
    const { filePath, fileSizeMB } = await downloadToTemp(
      item.url,
      item.type === "video",
    );

    try {
      if (fileSizeMB > 50) {
        await ctx.reply(
          `❌ Media${label ? ` ke-${label}` : ""} terlalu besar (${fileSizeMB.toFixed(1)} MB > 50 MB).`,
        );
        return;
      }

      if (item.type === "video") {
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
    } finally {
      fs.unlink(filePath, () => null);
    }
    return; // success
  } catch (downloadErr) {
    // If direct download failed (403 CDN), try Telegram URL-based send
    logger.warn(
      { err: downloadErr, url: item.url },
      "Direct download failed, trying Telegram URL send",
    );
  }

  // Strategy 2: pass URL directly — let Telegram download from CDN
  try {
    if (item.type === "video") {
      await ctx.replyWithVideo(item.url, { caption, parse_mode: "Markdown" });
    } else {
      await ctx.replyWithPhoto(item.url, { caption, parse_mode: "Markdown" });
    }
    return;
  } catch (telegramErr) {
    logger.warn({ err: telegramErr }, "Telegram URL send also failed");
    throw new Error(
      `Tidak dapat mengunduh media (CDN dibatasi dan Telegram juga gagal). URL expired atau diblokir.`,
    );
  }
}

// ─── Download helper ──────────────────────────────────────────────────────────
async function downloadToTemp(
  url: string,
  isVideo: boolean,
): Promise<{ filePath: string; fileSizeMB: number }> {
  const ext = isVideo ? ".mp4" : ".jpg";
  const fileName = `threads_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      "Referer": "https://www.threads.com/",
      "Accept": "*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} saat mengunduh`);
  }

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

  const stat = fs.statSync(filePath);
  return { filePath, fileSizeMB: stat.size / (1024 * 1024) };
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
