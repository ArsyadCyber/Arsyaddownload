import { Bot, Context, InlineKeyboard } from "grammy";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../../lib/logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ShalatUser {
  chatId: number;
  provinsi: string;
  kabkota: string;
  lastChanged: number;      // ms timestamp
  notifEnabled: boolean;
  notifMinutes: number[];   // e.g. [5, 10, 15]
}

interface DaySchedule {
  tanggal: number;
  tanggal_lengkap: string;
  hari: string;
  imsak: string;
  subuh: string;
  terbit: string;
  dhuha: string;
  dzuhur: string;
  ashar: string;
  maghrib: string;
  isya: string;
}

// ─── Storage ───────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "shalat-users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsers(): Map<number, ShalatUser> {
  ensureDataDir();
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw: ShalatUser[] = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
      return new Map(raw.map((u) => [u.chatId, u]));
    }
  } catch {}
  return new Map();
}

function persistUsers(map: Map<number, ShalatUser>) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify([...map.values()], null, 2));
}

const usersMap = loadUsers();

function getUser(chatId: number): ShalatUser | undefined {
  return usersMap.get(chatId);
}

function saveUser(user: ShalatUser) {
  usersMap.set(user.chatId, user);
  persistUsers(usersMap);
}

// ─── API ───────────────────────────────────────────────────────────────────

const API_BASE = "https://equran.id/api/v2/shalat";

async function apiGet(endpoint: string): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Province list — fetched once, cached
let provinsiCache: string[] | null = null;

export async function getProvinsiList(): Promise<string[]> {
  if (provinsiCache) return provinsiCache;
  const d = await apiGet("/provinsi");
  provinsiCache = d.data as string[];
  return provinsiCache;
}

async function getKabkotaList(provinsi: string): Promise<string[]> {
  const d = await apiPost("/kabkota", { provinsi });
  return d.data as string[];
}

// Month schedule cache — key: `provinsi|kabkota|YYYY-MM`
const monthCache = new Map<string, DaySchedule[]>();

async function getMonthSchedule(
  provinsi: string,
  kabkota: string,
  year: number,
  month: number
): Promise<DaySchedule[]> {
  const cacheKey = `${provinsi}|${kabkota}|${year}-${String(month).padStart(2, "0")}`;
  if (monthCache.has(cacheKey)) return monthCache.get(cacheKey)!;
  const tanggal = `${year}/${String(month).padStart(2, "0")}/01`;
  const d = await apiPost("", { provinsi, kabkota, tanggal });
  const schedule = d.data.jadwal as DaySchedule[];
  monthCache.set(cacheKey, schedule);
  return schedule;
}

export async function getScheduleForDate(
  provinsi: string,
  kabkota: string,
  offsetDays = 0
): Promise<DaySchedule | null> {
  const utcOffset = getProvinsiUtcOffset(provinsi);
  const local = getLocalDate(utcOffset, offsetDays);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const schedule = await getMonthSchedule(provinsi, kabkota, year, month);
  return schedule.find((s) => s.tanggal === day) ?? null;
}

// ─── Timezone mapping ──────────────────────────────────────────────────────

/**
 * Maps each Indonesian province to its UTC offset.
 * WIB = UTC+7 (Sumatera, Jawa, Kalimantan Barat & Tengah)
 * WITA = UTC+8 (Kalimantan Selatan/Timur/Utara, Sulawesi, Bali, NTB, NTT)
 * WIT  = UTC+9 (Maluku, Papua)
 */
const PROVINCE_UTC_OFFSET: Record<string, number> = {
  // WIB (UTC+7)
  "Aceh": 7,
  "Sumatera Utara": 7,
  "Sumatera Barat": 7,
  "Riau": 7,
  "Kepulauan Riau": 7,
  "Jambi": 7,
  "Bengkulu": 7,
  "Sumatera Selatan": 7,
  "Kepulauan Bangka Belitung": 7,
  "Lampung": 7,
  "Banten": 7,
  "DKI Jakarta": 7,
  "Jawa Barat": 7,
  "Jawa Tengah": 7,
  "D.I. Yogyakarta": 7,
  "Jawa Timur": 7,
  "Kalimantan Barat": 7,
  "Kalimantan Tengah": 7,
  // WITA (UTC+8)
  "Kalimantan Selatan": 8,
  "Kalimantan Timur": 8,
  "Kalimantan Utara": 8,
  "Bali": 8,
  "Nusa Tenggara Barat": 8,
  "Nusa Tenggara Timur": 8,
  "Gorontalo": 8,
  "Sulawesi Barat": 8,
  "Sulawesi Selatan": 8,
  "Sulawesi Tengah": 8,
  "Sulawesi Tenggara": 8,
  "Sulawesi Utara": 8,
  // WIT (UTC+9)
  "Maluku": 9,
  "Maluku Utara": 9,
  "Papua": 9,
  "Papua Barat": 9,
};

const TZ_LABEL: Record<number, string> = { 7: "WIB", 8: "WITA", 9: "WIT" };

export function getProvinsiUtcOffset(provinsi: string): number {
  return PROVINCE_UTC_OFFSET[provinsi] ?? 7;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns a "local" Date object whose UTC fields represent local time.
 * utcOffset: 7 = WIB, 8 = WITA, 9 = WIT
 */
function getLocalDate(utcOffset: number, offsetDays = 0): Date {
  return new Date(Date.now() + (utcOffset * 3600 + offsetDays * 86400) * 1000);
}

function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}

const BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const PRAYERS: { key: keyof DaySchedule; label: string; emoji: string; fard: boolean }[] = [
  { key: "imsak",   label: "Imsak",   emoji: "⭐",  fard: false },
  { key: "subuh",   label: "Subuh",   emoji: "🌅",  fard: true  },
  { key: "dzuhur",  label: "Dzuhur",  emoji: "☀️",  fard: true  },
  { key: "ashar",   label: "Ashar",   emoji: "🌤️", fard: true  },
  { key: "maghrib", label: "Maghrib", emoji: "🌆",  fard: true  },
  { key: "isya",    label: "Isya",    emoji: "🌙",  fard: true  },
];

function prayerTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatSchedule(s: DaySchedule, provinsi: string, kabkota: string, label = "Jadwal Sholat"): string {
  const [y, mo] = s.tanggal_lengkap.split("-");
  const dateStr = `${s.hari}, ${s.tanggal} ${BULAN[parseInt(mo)]} ${y}`;
  const utcOffset = getProvinsiUtcOffset(provinsi);
  const tzLabel = TZ_LABEL[utcOffset] ?? "WIB";
  let msg = `📅 *${esc(label)}*\n`;
  msg += `📍 ${esc(kabkota)}, ${esc(provinsi)}\n`;
  msg += `🗓 ${esc(dateStr)} \\(${tzLabel}\\)\n\n`;
  msg += PRAYERS.map((p) => {
    const time = s[p.key] as string;
    const label2 = p.label.padEnd(7);
    return `${p.emoji} \`${label2}\` ${time}`;
  }).join("\n");
  return msg;
}

function notifStatusLine(user: ShalatUser): string {
  if (!user.notifEnabled || user.notifMinutes.length === 0) {
    return `_🔕 Notifikasi: Mati_`;
  }
  const mins = [...user.notifMinutes].sort((a, b) => a - b).join(", ");
  return `_🔔 Notifikasi: ${esc(mins)} menit sebelum adzan_`;
}

// ─── Sessions ──────────────────────────────────────────────────────────────

type ShalatStage = "selecting_prov" | "selecting_kota";

interface ShalatSession {
  stage: ShalatStage;
  provinsiList: string[];
  kabkotaList?: string[];
  selectedProvinsi?: string;
  provPage: number;
  kotaPage: number;
  createdAt: number;
}

const TTL = 10 * 60 * 1000;
const sessions = new Map<number, ShalatSession>();

function getSession(chatId: number) { return sessions.get(chatId); }
function setSession(chatId: number, s: ShalatSession) {
  sessions.set(chatId, s);
  setTimeout(() => sessions.delete(chatId), TTL);
}
function delSession(chatId: number) { sessions.delete(chatId); }

export function hasActiveShalatSession(chatId: number): boolean {
  return sessions.has(chatId);
}

// ─── Keyboards ─────────────────────────────────────────────────────────────

const PROV_PER_PAGE = 12;
const KOTA_PER_PAGE = 10;

function provKeyboard(list: string[], page: number): InlineKeyboard {
  const slice = list.slice(page * PROV_PER_PAGE, (page + 1) * PROV_PER_PAGE);
  const kb = new InlineKeyboard();
  slice.forEach((prov, i) => {
    if (i > 0 && i % 3 === 0) kb.row();
    kb.text(prov, `shalat:setp:${prov}`);
  });
  const total = Math.ceil(list.length / PROV_PER_PAGE);
  if (total > 1) {
    kb.row();
    if (page > 0) kb.text("◀️", `shalat:pp:${page - 1}`);
    kb.text(`${page + 1}/${total}`, "shalat:noop");
    if (page < total - 1) kb.text("▶️", `shalat:pp:${page + 1}`);
  }
  kb.row().text("❌ Batal", "shalat:cancel");
  return kb;
}

function kotaKeyboard(list: string[], page: number): InlineKeyboard {
  const slice = list.slice(page * KOTA_PER_PAGE, (page + 1) * KOTA_PER_PAGE);
  const kb = new InlineKeyboard();
  slice.forEach((kota, i) => {
    if (i > 0 && i % 2 === 0) kb.row();
    kb.text(kota, `shalat:setk:${kota}`);
  });
  const total = Math.ceil(list.length / KOTA_PER_PAGE);
  if (total > 1) {
    kb.row();
    if (page > 0) kb.text("◀️", `shalat:kp:${page - 1}`);
    kb.text(`${page + 1}/${total}`, "shalat:noop");
    if (page < total - 1) kb.text("▶️", `shalat:kp:${page + 1}`);
  }
  kb.row().text("🔙 Provinsi", "shalat:backprov").text("❌ Batal", "shalat:cancel");
  return kb;
}

function mainKeyboard(user: ShalatUser): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (user.notifEnabled) {
    kb.text("⚙️ Atur Notif", "shalat:notif:menu").text("🔕 Matikan", "shalat:notif:off");
  } else {
    kb.text("🔔 Aktifkan Notif", "shalat:notif:menu");
  }
  kb.row()
    .text("📅 Jadwal Besok", "shalat:tomorrow")
    .text("📍 Ganti Lokasi", "shalat:change");
  return kb;
}

function notifKeyboard(user: ShalatUser): InlineKeyboard {
  const active = new Set(user.notifMinutes);
  const kb = new InlineKeyboard();
  [5, 10, 15, 20, 30].forEach((min, i) => {
    if (i > 0 && i % 3 === 0) kb.row();
    kb.text(`${active.has(min) ? "✅ " : ""}${min} menit`, `shalat:notif:tog:${min}`);
  });
  kb.row();
  if (active.size > 0) kb.text("💾 Simpan & Aktifkan", "shalat:notif:save");
  if (user.notifEnabled) kb.text("🔕 Matikan Semua", "shalat:notif:off");
  kb.row().text("🔙 Kembali", "shalat:menu");
  return kb;
}

// ─── Main entry points ─────────────────────────────────────────────────────

export async function handleShalatMenu(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const user = getUser(chatId);
  if (!user) {
    await startProvSetup(ctx, chatId, false);
  } else {
    await showToday(ctx, user, false);
  }
}

// ─── Province / Kota selection flow ────────────────────────────────────────

async function startProvSetup(ctx: Context, chatId: number, editing: boolean) {
  try {
    const list = await getProvinsiList();
    setSession(chatId, { stage: "selecting_prov", provinsiList: list, provPage: 0, kotaPage: 0, createdAt: Date.now() });
    const kb = provKeyboard(list, 0);
    const text = `🕌 *Jadwal Sholat*\n\nPilih *provinsi* tempat tinggalmu:`;
    if (editing) {
      await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: kb }).catch(() =>
        ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: kb })
      );
    } else {
      await ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: kb });
    }
  } catch (e) {
    logger.error({ err: e }, "shalat: load provinces failed");
    await ctx.reply("❌ Gagal memuat daftar provinsi\\. Coba lagi\\.", { parse_mode: "MarkdownV2" });
  }
}

export async function handleProvPageCb(ctx: Context, page: number) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const session = getSession(chatId);
  if (!session) { await ctx.answerCallbackQuery({ text: "Sesi kadaluarsa. Ketik /sholat lagi." }); return; }
  session.provPage = page;
  await ctx.editMessageReplyMarkup({ reply_markup: provKeyboard(session.provinsiList, page) }).catch(() => null);
}

export async function handleProvSelectCb(ctx: Context, provinsi: string) {
  const chatId = ctx.chat!.id;
  let session = getSession(chatId);
  if (!session) {
    try {
      const list = await getProvinsiList();
      session = { stage: "selecting_prov", provinsiList: list, provPage: 0, kotaPage: 0, createdAt: Date.now() };
      setSession(chatId, session);
    } catch {
      await ctx.answerCallbackQuery({ text: "Sesi kadaluarsa. Ketik /sholat lagi." });
      return;
    }
  }
  await ctx.answerCallbackQuery({ text: `📍 ${provinsi}` });
  try {
    const kotaList = await getKabkotaList(provinsi);
    session.stage = "selecting_kota";
    session.selectedProvinsi = provinsi;
    session.kabkotaList = kotaList;
    session.kotaPage = 0;
    setSession(chatId, session);
    const kb = kotaKeyboard(kotaList, 0);
    const text = `📍 *Pilih Kabupaten/Kota*\n\nProvinsi: *${esc(provinsi)}*\n\nPilih kabupaten/kota tempat tinggalmu:`;
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: kb }).catch(() =>
      ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: kb })
    );
  } catch (e) {
    logger.error({ err: e }, "shalat: load kabkota failed");
    await ctx.reply("❌ Gagal memuat daftar kota\\. Coba lagi\\.", { parse_mode: "MarkdownV2" });
  }
}

export async function handleKotaPageCb(ctx: Context, page: number) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const session = getSession(chatId);
  if (!session?.kabkotaList) { return; }
  session.kotaPage = page;
  await ctx.editMessageReplyMarkup({ reply_markup: kotaKeyboard(session.kabkotaList, page) }).catch(() => null);
}

export async function handleKotaSelectCb(ctx: Context, kabkota: string) {
  const chatId = ctx.chat!.id;
  const session = getSession(chatId);
  const provinsi = session?.selectedProvinsi;
  if (!provinsi) {
    await ctx.answerCallbackQuery({ text: "Sesi kadaluarsa. Ketik /sholat lagi." });
    return;
  }
  await ctx.answerCallbackQuery({ text: `✅ ${kabkota} dipilih!` });

  const existing = getUser(chatId);
  const user: ShalatUser = {
    chatId,
    provinsi,
    kabkota,
    lastChanged: Date.now(),
    notifEnabled: existing?.notifEnabled ?? false,
    notifMinutes: existing?.notifMinutes ?? [],
  };
  saveUser(user);
  delSession(chatId);

  await ctx.editMessageText(`⏳ Menyimpan lokasi & mengambil jadwal\\.\\.\\.`, { parse_mode: "MarkdownV2" }).catch(() => null);

  try {
    const schedule = await getScheduleForDate(provinsi, kabkota);
    if (!schedule) {
      await ctx.reply("✅ Lokasi tersimpan\\! Ketik /sholat untuk melihat jadwal\\.", { parse_mode: "MarkdownV2" });
      return;
    }
    const text =
      `✅ *Lokasi Berhasil Disimpan\\!*\n\n` +
      `📍 *${esc(kabkota)}, ${esc(provinsi)}*\n\n` +
      formatSchedule(schedule, provinsi, kabkota) +
      `\n\n${notifStatusLine(user)}\n\n` +
      `_💡 Lokasi hanya bisa diubah sekali per 24 jam_`;
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: mainKeyboard(user) }).catch(() =>
      ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: mainKeyboard(user) })
    );
  } catch (e) {
    logger.error({ err: e }, "shalat: load schedule after save failed");
    await ctx.reply("✅ Lokasi tersimpan\\! Gunakan /sholat untuk melihat jadwal\\.", { parse_mode: "MarkdownV2" });
  }
}

export async function handleBackToProvCb(ctx: Context) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const session = getSession(chatId);
  if (!session) { return; }
  session.stage = "selecting_prov";
  await ctx.editMessageText(
    `🕌 *Jadwal Sholat*\n\nPilih *provinsi* tempat tinggalmu:`,
    { parse_mode: "MarkdownV2", reply_markup: provKeyboard(session.provinsiList, session.provPage) }
  ).catch(() => null);
}

export async function handleCancelCb(ctx: Context) {
  await ctx.answerCallbackQuery({ text: "Dibatalkan." });
  delSession(ctx.chat!.id);
  await ctx.deleteMessage().catch(() => null);
}

// ─── Today / Tomorrow ──────────────────────────────────────────────────────

async function showToday(ctx: Context, user: ShalatUser, editing: boolean) {
  const loadingMsg = editing ? null : await ctx.reply("📅 Mengambil jadwal sholat\\.\\.\\.").catch(() => null);
  try {
    const schedule = await getScheduleForDate(user.provinsi, user.kabkota);
    if (loadingMsg) await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => null);
    if (!schedule) {
      await ctx.reply("❌ Jadwal tidak ditemukan\\.", { parse_mode: "MarkdownV2" });
      return;
    }
    const text = formatSchedule(schedule, user.provinsi, user.kabkota) + `\n\n${notifStatusLine(user)}`;
    if (editing) {
      await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: mainKeyboard(user) }).catch(() =>
        ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: mainKeyboard(user) })
      );
    } else {
      await ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: mainKeyboard(user) });
    }
  } catch (e) {
    if (loadingMsg) await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => null);
    logger.error({ err: e }, "shalat: show today failed");
    await ctx.reply("❌ Gagal mengambil jadwal\\. Coba lagi nanti\\.", { parse_mode: "MarkdownV2" });
  }
}

export async function handleMenuCb(ctx: Context) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) { await handleShalatMenu(ctx); return; }
  await showToday(ctx, user, true);
}

export async function handleTomorrowCb(ctx: Context) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) return;
  try {
    const schedule = await getScheduleForDate(user.provinsi, user.kabkota, 1);
    if (!schedule) { await ctx.answerCallbackQuery({ text: "Jadwal besok tidak tersedia." }); return; }
    const text = formatSchedule(schedule, user.provinsi, user.kabkota, "Jadwal Sholat Besok") + `\n\n${notifStatusLine(user)}`;
    const kb = new InlineKeyboard()
      .text("📅 Hari Ini", "shalat:menu")
      .text(user.notifEnabled ? "🔕 Matikan Notif" : "🔔 Aktifkan Notif", user.notifEnabled ? "shalat:notif:off" : "shalat:notif:menu");
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: kb }).catch(() =>
      ctx.reply(text, { parse_mode: "MarkdownV2", reply_markup: kb })
    );
  } catch (e) {
    logger.error({ err: e }, "shalat: tomorrow failed");
  }
}

// ─── Location change ────────────────────────────────────────────────────────

export async function handleChangeCb(ctx: Context) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (user) {
    const elapsed = Date.now() - user.lastChanged;
    if (elapsed < 24 * 3600 * 1000) {
      const remaining = 24 * 3600 * 1000 - elapsed;
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const timeStr = h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
      const kb = new InlineKeyboard().text("🔙 Kembali", "shalat:menu");
      await ctx.editMessageText(
        `⏳ *Belum Bisa Ganti Lokasi*\n\n` +
        `Lokasi hanya bisa diubah *1x per 24 jam*\\.\n` +
        `📍 Lokasi sekarang: *${esc(user.kabkota)}, ${esc(user.provinsi)}*\n\n` +
        `Bisa ganti lagi dalam: *${esc(timeStr)}*`,
        { parse_mode: "MarkdownV2", reply_markup: kb }
      ).catch(() =>
        ctx.reply(
          `⏳ Lokasi hanya bisa diubah 1x per 24 jam\\. Tunggu *${esc(timeStr)}* lagi\\.`,
          { parse_mode: "MarkdownV2" }
        )
      );
      return;
    }
  }
  await startProvSetup(ctx, chatId, true);
}

// ─── Notification settings ──────────────────────────────────────────────────

export async function handleNotifMenuCb(ctx: Context) {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) return;
  const current = user.notifEnabled && user.notifMinutes.length > 0
    ? `Aktif: ${[...user.notifMinutes].sort((a, b) => a - b).join(", ")} menit sebelum adzan`
    : "Belum ada notifikasi aktif";
  const text =
    `🔔 *Pengaturan Notifikasi*\n\n` +
    `📍 ${esc(user.kabkota)}, ${esc(user.provinsi)}\n\n` +
    `Pilih berapa menit sebelum adzan kamu mau diingatkan:\n` +
    `_${esc(current)}_\n\n` +
    `_Bisa pilih lebih dari satu\\!_`;
  await ctx.editMessageText(text, { parse_mode: "MarkdownV2", reply_markup: notifKeyboard(user) }).catch(() => null);
}

export async function handleNotifToggleCb(ctx: Context, minutes: number) {
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) { await ctx.answerCallbackQuery(); return; }
  const set = new Set(user.notifMinutes);
  if (set.has(minutes)) { set.delete(minutes); } else { set.add(minutes); }
  user.notifMinutes = [...set];
  saveUser(user);
  await ctx.editMessageReplyMarkup({ reply_markup: notifKeyboard(user) }).catch(() => null);
  await ctx.answerCallbackQuery({ text: set.has(minutes) ? `✅ ${minutes} menit ditambahkan` : `❌ ${minutes} menit dihapus` });
}

export async function handleNotifSaveCb(ctx: Context) {
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) { await ctx.answerCallbackQuery(); return; }
  if (user.notifMinutes.length === 0) {
    await ctx.answerCallbackQuery({ text: "Pilih minimal 1 opsi dulu!" });
    return;
  }
  user.notifEnabled = true;
  saveUser(user);
  const mins = [...user.notifMinutes].sort((a, b) => a - b).join(", ");
  await ctx.answerCallbackQuery({ text: `✅ Notif ${mins} menit sebelum adzan aktif!` });
  await showToday(ctx, user, true);
}

export async function handleNotifOffCb(ctx: Context) {
  const chatId = ctx.chat!.id;
  const user = getUser(chatId);
  if (!user) { await ctx.answerCallbackQuery(); return; }
  user.notifEnabled = false;
  user.notifMinutes = [];
  saveUser(user);
  await ctx.answerCallbackQuery({ text: "🔕 Notifikasi dimatikan" });
  await showToday(ctx, user, true);
}

// ─── Scheduler ─────────────────────────────────────────────────────────────

const notifSent = new Set<string>(); // `chatId:YYYY-MM-DD:prayer:minutes`

export function startShalatScheduler(bot: Bot) {
  setInterval(async () => {
    for (const [, user] of usersMap) {
      if (!user.notifEnabled || user.notifMinutes.length === 0) continue;

      // Use each user's local timezone for correct day and clock comparison
      const utcOffset = getProvinsiUtcOffset(user.provinsi);
      const localNow = getLocalDate(utcOffset);
      const nowMins = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
      const todayStr = localNow.toISOString().slice(0, 10); // YYYY-MM-DD in local time

      // Clean up sent-notification keys that are not from today (local)
      for (const key of notifSent) {
        if (key.startsWith(`${user.chatId}:`) && !key.includes(`:${todayStr}:`)) {
          notifSent.delete(key);
        }
      }

      try {
        const schedule = await getScheduleForDate(user.provinsi, user.kabkota);
        if (!schedule) continue;

        const tzLabel = TZ_LABEL[utcOffset] ?? "WIB";

        for (const p of PRAYERS.filter((x) => x.fard)) {
          const pTime = schedule[p.key] as string;
          const pMins = prayerTimeToMinutes(pTime);

          for (const before of user.notifMinutes) {
            const trigger = pMins - before;
            // Trigger window: [trigger, trigger+1) minutes — checked every 30s
            if (nowMins >= trigger && nowMins < trigger + 1) {
              const sentKey = `${user.chatId}:${todayStr}:${p.key}:${before}`;
              if (notifSent.has(sentKey)) continue;
              notifSent.add(sentKey);

              const msg =
                `🔔 *Pengingat Sholat*\n\n` +
                `${p.emoji} *${before} menit lagi — ${p.label}*\n` +
                `📍 ${esc(user.kabkota)}\n` +
                `🕐 Waktu ${p.label}: *${pTime}* ${tzLabel}`;

              await bot.api
                .sendMessage(user.chatId, msg, { parse_mode: "MarkdownV2" })
                .catch((e) => logger.error({ err: e, chatId: user.chatId }, "shalat: notif send failed"));
            }
          }
        }
      } catch {
        // Skip user on error, will retry next interval
      }
    }
  }, 30_000);
}
