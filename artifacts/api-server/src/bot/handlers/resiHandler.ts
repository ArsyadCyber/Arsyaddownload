import { Context, InlineKeyboard } from "grammy";
import { spawn } from "child_process";
import * as path from "path";
import { logger } from "../../lib/logger";

const SCRIPT_DIR = path.resolve(__dirname, "../src/bot/utils");

function runPython(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPT_DIR, script);
    const env = {
      ...process.env,
      ...(process.env.BINDERBYTE_API_KEY ? { BINDERBYTE_API_KEY: process.env.BINDERBYTE_API_KEY } : {}),
    };
    const proc = spawn("python3", [scriptPath, ...args], { env });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("close", (code) => {
      if (code !== 0 && !out.trim()) reject(new Error(err || `exit ${code}`));
      else resolve(out.trim());
    });
    proc.on("error", reject);
    setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 30000);
  });
}

const TTL_MS = 10 * 60 * 1000;

interface ResiSession {
  stage: "waiting_awb";
  promptMsgId?: number;
  createdAt: number;
}

const sessions = new Map<number, ResiSession>();

function saveSession(chatId: number, session: ResiSession) {
  sessions.set(chatId, session);
  setTimeout(() => sessions.delete(chatId), TTL_MS);
}
function getSession(chatId: number): ResiSession | undefined {
  return sessions.get(chatId);
}
function deleteSession(chatId: number) {
  sessions.delete(chatId);
}

export function hasActiveResiSession(chatId: number): boolean {
  return sessions.has(chatId);
}

export async function handleResiMenu(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  deleteSession(chatId);
  saveSession(chatId, { stage: "waiting_awb", createdAt: Date.now() });

  const msg = await ctx.reply(
    "📬 *Cek Resi Pengiriman*\n\n" +
    "Ketik *nomor resi* pengiriman kamu:\n\n" +
    "_Didukung: JNE, J\\&T, SiCepat, TIKI, Pos Indonesia, Anteraja, Lion Parcel, dan kurir lain_",
    { parse_mode: "MarkdownV2" }
  );
  const session = getSession(chatId)!;
  session.promptMsgId = msg.message_id;
  saveSession(chatId, session);
}

interface TrackingEvent {
  time: string;
  desc: string;
  location?: string;
}

interface TrackResult {
  awb?: string;
  courier?: string;
  status?: string;
  source?: string;
  events_count?: number;
  events?: TrackingEvent[];
  formatted?: string[];
  error?: string;
  detected_courier?: string;
  needs_api_key?: boolean;
  message?: string;
}

export async function handleResiTextInput(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text?.trim();
  if (!chatId || !text) return false;

  const session = getSession(chatId);
  if (!session) return false;

  if (session.stage === "waiting_awb") {
    const awb = text.toUpperCase().replace(/\s+/g, "");
    if (awb.length < 5) {
      await ctx.reply("❌ Nomor resi terlalu pendek. Masukkan nomor resi yang valid:");
      return true;
    }

    const statusMsg = await ctx.reply("📬 Sedang melacak pengiriman...");
    try {
      const raw = await runPython("resiScrape.py", [awb]);
      const result: TrackResult = JSON.parse(raw);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      deleteSession(chatId);

      if (result.error) {
        const detectedCourier = result.detected_courier || "Unknown";
        const kb = new InlineKeyboard().text("🔄 Cek Resi Lain", "resi_start");
        const needsKey = result.needs_api_key;
        await ctx.reply(
          `❌ *Resi Tidak Ditemukan*\n\n` +
          `📦 Nomor: \`${awb}\`\n` +
          `🚚 Kurir Terdeteksi: ${detectedCourier}\n\n` +
          `${result.message || "Pastikan nomor resi benar dan pengiriman sudah diproses."}\n\n` +
          (needsKey
            ? `💡 _Untuk melacak SPX & J\\&T, bot perlu API key Binderbyte\\. Hubungi admin\\._`
            : `💡 _Coba cek langsung di app Shopee/TikTok jika resi baru dibuat\\._`),
          { parse_mode: "MarkdownV2", reply_markup: kb }
        );
        return true;
      }

      const events = result.events || [];
      const kb = new InlineKeyboard().text("🔄 Cek Resi Lain", "resi_start");

      if (events.length === 0) {
        const c2 = (result.courier || "Tidak diketahui").replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&");
        const s2 = (result.status || "Belum ada data").replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&");
        await ctx.reply(
          `📬 *Hasil Lacak Resi*\n\n` +
          `📦 Nomor: \`${awb}\`\n` +
          `🚚 Kurir: ${c2}\n` +
          `📊 Status: ${s2}\n\n` +
          `ℹ️ Belum ada data perjalanan\\. Mungkin baru diproses\\.`,
          { parse_mode: "MarkdownV2", reply_markup: kb }
        );
        return true;
      }

      const eventLines = events.slice(0, 8).map((ev) => {
        const t = ev.time ? `🕐 ${ev.time}` : "";
        const d = ev.desc ? `   └ ${ev.desc}` : "";
        const loc = ev.location ? `   📍 ${ev.location}` : "";
        return [t, d, loc].filter(Boolean).join("\n");
      });

      const statusText = (result.status || events[0]?.desc || "-").replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&");
      const courierText = (result.courier || "Terdeteksi otomatis").replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&");
      const sourceText = (result.source || "Global Tracking").replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&");
      const eventsText = eventLines
        .map((line) => line.replace(/[*_`[\]()~>#+=|{}.!\\-]/g, "\\$&"))
        .join("\n\n");

      await ctx.reply(
        `📬 *Hasil Lacak Resi*\n\n` +
        `📦 No Resi: \`${awb}\`\n` +
        `🚚 Kurir: ${courierText}\n` +
        `📊 Status Terakhir: *${statusText}*\n` +
        `📋 Total Update: ${result.events_count || events.length}\n\n` +
        `*Riwayat Perjalanan:*\n${eventsText}\n\n` +
        `_Sumber: ${sourceText}_`,
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    } catch (e) {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      logger.error({ err: e }, "resi tracking error");
      deleteSession(chatId);
      await ctx.reply("❌ Gagal melacak resi. Coba lagi nanti.");
    }
    return true;
  }

  return false;
}
