import { Context, InlineKeyboard } from "grammy";
import { spawn } from "child_process";
import * as path from "path";
import { logger } from "../../lib/logger";

const SCRIPT_DIR = path.resolve(__dirname, "../src/bot/utils");

function runPython(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPT_DIR, script);
    const proc = spawn("python3", [scriptPath, ...args]);
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

interface CityResult {
  id: string;
  name: string;
}

interface CostResult {
  company_name: string;
  price: string;
}

const TTL_MS = 10 * 60 * 1000;

interface OngkirSession {
  stage: "waiting_origin" | "waiting_dest" | "waiting_weight" | "waiting_origin_select" | "waiting_dest_select";
  originQuery?: string;
  originId?: string;
  originName?: string;
  destQuery?: string;
  destId?: string;
  destName?: string;
  cityCandidates?: CityResult[];
  cityTarget?: "origin" | "dest";
  promptMsgId?: number;
  createdAt: number;
}

const sessions = new Map<number, OngkirSession>();

function saveSession(chatId: number, session: OngkirSession) {
  sessions.set(chatId, session);
  setTimeout(() => sessions.delete(chatId), TTL_MS);
}
function getSession(chatId: number): OngkirSession | undefined {
  return sessions.get(chatId);
}
function deleteSession(chatId: number) {
  sessions.delete(chatId);
}

export function hasActiveOngkirSession(chatId: number): boolean {
  return sessions.has(chatId);
}

export async function handleOngkirMenu(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  deleteSession(chatId);
  saveSession(chatId, { stage: "waiting_origin", createdAt: Date.now() });

  const msg = await ctx.reply(
    "📦 *Cek Ongkos Kirim*\n\nKetik nama *kota/kabupaten asal* pengiriman:\n_Contoh: Jakarta, Bandung, Surabaya_",
    { parse_mode: "Markdown" }
  );
  const session = getSession(chatId)!;
  session.promptMsgId = msg.message_id;
  saveSession(chatId, session);
}

export async function handleOngkirTextInput(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text?.trim();
  if (!chatId || !text) return false;

  const session = getSession(chatId);
  if (!session) return false;

  if (session.stage === "waiting_origin") {
    const statusMsg = await ctx.reply("🔍 Mencari kota...");
    try {
      const raw = await runPython("ongkirScrape.py", ["city", text]);
      const cities: CityResult[] = JSON.parse(raw);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);

      if (!cities || cities.length === 0) {
        await ctx.reply("❌ Kota tidak ditemukan. Coba kata kunci lain:");
        return true;
      }

      if (cities.length === 1) {
        session.originId = cities[0]!.id;
        session.originName = cities[0]!.name;
        session.stage = "waiting_dest";
        saveSession(chatId, session);
        const prompt = await ctx.reply(
          `✅ Asal: *${cities[0]!.name}*\n\nKetik nama *kota/kabupaten tujuan*:`,
          { parse_mode: "Markdown" }
        );
        session.promptMsgId = prompt.message_id;
        saveSession(chatId, session);
      } else {
        session.stage = "waiting_origin_select";
        session.cityCandidates = cities.slice(0, 10);
        session.cityTarget = "origin";
        saveSession(chatId, session);

        const kb = new InlineKeyboard();
        for (const c of cities.slice(0, 10)) {
          kb.text(c.name, `ongkir:city:${c.id}:${encodeURIComponent(c.name)}`).row();
        }
        kb.text("❌ Batal", "ongkir:cancel");
        await ctx.reply("Pilih kota asal:", { reply_markup: kb });
      }
    } catch (e) {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      logger.error({ err: e }, "ongkir city search error");
      await ctx.reply("❌ Gagal mencari kota. Coba lagi.");
      deleteSession(chatId);
    }
    return true;
  }

  if (session.stage === "waiting_dest") {
    const statusMsg = await ctx.reply("🔍 Mencari kota tujuan...");
    try {
      const raw = await runPython("ongkirScrape.py", ["city", text]);
      const cities: CityResult[] = JSON.parse(raw);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);

      if (!cities || cities.length === 0) {
        await ctx.reply("❌ Kota tidak ditemukan. Coba kata kunci lain:");
        return true;
      }

      if (cities.length === 1) {
        session.destId = cities[0]!.id;
        session.destName = cities[0]!.name;
        session.stage = "waiting_weight";
        saveSession(chatId, session);
        await ctx.reply(
          `✅ Tujuan: *${cities[0]!.name}*\n\nKetik *berat paket* (gram):\n_Contoh: 500, 1000, 2000_`,
          { parse_mode: "Markdown" }
        );
      } else {
        session.stage = "waiting_dest_select";
        session.cityCandidates = cities.slice(0, 10);
        session.cityTarget = "dest";
        saveSession(chatId, session);

        const kb = new InlineKeyboard();
        for (const c of cities.slice(0, 10)) {
          kb.text(c.name, `ongkir:city:${c.id}:${encodeURIComponent(c.name)}`).row();
        }
        kb.text("❌ Batal", "ongkir:cancel");
        await ctx.reply("Pilih kota tujuan:", { reply_markup: kb });
      }
    } catch (e) {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      logger.error({ err: e }, "ongkir dest city search error");
      await ctx.reply("❌ Gagal mencari kota. Coba lagi.");
      deleteSession(chatId);
    }
    return true;
  }

  if (session.stage === "waiting_weight") {
    const weight = parseInt(text.replace(/[^0-9]/g, ""), 10);
    if (isNaN(weight) || weight < 1) {
      await ctx.reply("❌ Berat tidak valid. Masukkan angka dalam gram (contoh: 1000):");
      return true;
    }

    const statusMsg = await ctx.reply("⏳ Sedang mengecek ongkos kirim...");
    try {
      const raw = await runPython("ongkirScrape.py", ["cost", session.originId!, session.destId!, String(weight)]);
      const costs: CostResult[] = JSON.parse(raw);
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      deleteSession(chatId);

      if (!costs || costs.length === 0) {
        await ctx.reply("❌ Data ongkos kirim tidak ditemukan untuk rute ini.");
        return true;
      }

      const lines = costs.map((c) => {
        const price = parseInt(c.price, 10);
        return `• *${c.company_name}*: Rp${price.toLocaleString("id-ID")}`;
      });

      const kb = new InlineKeyboard().text("📦 Cek Lagi", "ongkir_start");
      await ctx.reply(
        `📦 *Hasil Cek Ongkir*\n\n` +
        `🏠 Asal: ${session.originName}\n` +
        `📍 Tujuan: ${session.destName}\n` +
        `⚖️ Berat: ${weight.toLocaleString("id-ID")} gram\n\n` +
        `*Tarif Pengiriman:*\n${lines.join("\n")}\n\n` +
        `_Data dari ongkoskirim.id_`,
        { parse_mode: "Markdown", reply_markup: kb }
      );
    } catch (e) {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => null);
      logger.error({ err: e }, "ongkir cost check error");
      await ctx.reply("❌ Gagal mengambil data ongkir. Coba lagi nanti.");
      deleteSession(chatId);
    }
    return true;
  }

  return false;
}

export async function handleOngkirCityCallback(ctx: Context, cityId: string, cityNameEncoded: string) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: "Session sudah habis." });
    return;
  }

  const cityName = decodeURIComponent(cityNameEncoded);
  await ctx.deleteMessage().catch(() => null);

  if (session.cityTarget === "origin" || session.stage === "waiting_origin_select") {
    session.originId = cityId;
    session.originName = cityName;
    session.stage = "waiting_dest";
    session.cityCandidates = undefined;
    saveSession(chatId, session);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✅ Asal: *${cityName}*\n\nKetik nama *kota/kabupaten tujuan*:`,
      { parse_mode: "Markdown" }
    );
  } else {
    session.destId = cityId;
    session.destName = cityName;
    session.stage = "waiting_weight";
    session.cityCandidates = undefined;
    saveSession(chatId, session);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✅ Tujuan: *${cityName}*\n\nKetik *berat paket* (gram):\n_Contoh: 500, 1000, 2000_`,
      { parse_mode: "Markdown" }
    );
  }
}

export async function handleOngkirCancel(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (chatId) deleteSession(chatId);
  await ctx.answerCallbackQuery({ text: "❌ Dibatalkan." });
  await ctx.deleteMessage().catch(() => null);
}
