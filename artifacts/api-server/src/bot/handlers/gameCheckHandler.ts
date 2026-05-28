import { Context, InlineKeyboard } from "grammy";
import { logger } from "../../lib/logger";

const API_BASE = "https://api-cek-id-game-ten.vercel.app/api";

// ─── Game catalog ─────────────────────────────────────────────────────────────
interface GameDef {
  typeName: string;
  displayName: string;
  emoji: string;
  needsZoneId: boolean;
  userIdLabel?: string;   // custom label for userId field
  zoneIdLabel?: string;   // custom label for zoneId field
  userIdHint?: string;    // example hint
  zoneIdHint?: string;
}

const GAMES: GameDef[] = [
  { typeName: "mobile_legends", displayName: "Mobile Legends",    emoji: "⚔️",  needsZoneId: true,  userIdHint: "123456789",  zoneIdHint: "1234 (Server ID)",  zoneIdLabel: "Server ID" },
  { typeName: "free_fire",      displayName: "Free Fire",         emoji: "🔥",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "valorant",       displayName: "Valorant",          emoji: "🎯",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "call_of_duty",   displayName: "Call of Duty",      emoji: "💥",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "basketrio",      displayName: "Basketrio",         emoji: "🏀",  needsZoneId: true,  userIdHint: "123456789",  zoneIdHint: "1" },
  { typeName: "arena_of_valor", displayName: "Arena of Valor",    emoji: "🏆",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "eight_ball_pool",displayName: "8 Ball Pool",       emoji: "🎱",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "aether_gazer",   displayName: "Aether Gazer",      emoji: "🌌",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "auto_chess",     displayName: "Auto Chess",        emoji: "♟️",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "azur_lane",      displayName: "Azur Lane",         emoji: "⚓",  needsZoneId: true,  userIdHint: "123456789",  zoneIdHint: "1" },
  { typeName: "bad_landers",    displayName: "Bad Landers",       emoji: "🎮",  needsZoneId: true,  userIdHint: "123456789",  zoneIdHint: "1" },
  { typeName: "barbarq",        displayName: "BarbarQ",           emoji: "🏹",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "dragon_city",    displayName: "Dragon City",       emoji: "🐉",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "hago",           displayName: "Hago",              emoji: "🎲",  needsZoneId: false, userIdHint: "123456789" },
  { typeName: "point_blank",    displayName: "Point Blank",       emoji: "🎯",  needsZoneId: false, userIdHint: "123456789" },
];

const GAME_MAP = new Map<string, GameDef>(GAMES.map((g) => [g.typeName, g]));

// ─── In-memory session ────────────────────────────────────────────────────────
interface GameSession {
  typeName: string;
  stage: "waiting_userId" | "waiting_zoneId";
  userId?: string;
  promptMsgId?: number;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const sessions = new Map<number, GameSession>(); // keyed by chatId

function saveGameSession(chatId: number, session: GameSession) {
  sessions.set(chatId, session);
  setTimeout(() => sessions.delete(chatId), TTL_MS);
}
function getGameSession(chatId: number): GameSession | undefined {
  return sessions.get(chatId);
}
function deleteGameSession(chatId: number) {
  sessions.delete(chatId);
}

// ─── Exported: check if there's an active game session for this chat ──────────
export function hasActiveGameSession(chatId: number): boolean {
  return sessions.has(chatId);
}

// ─── Build main game picker keyboard ─────────────────────────────────────────
function buildGameKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  GAMES.forEach((game, idx) => {
    kb.text(`${game.emoji} ${game.displayName}`, `game:select:${game.typeName}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  if (GAMES.length % 2 !== 0) kb.row();
  kb.text("❌ Batal", "game:cancel");
  return kb;
}

// ─── /cekid command + button handler ─────────────────────────────────────────
export async function handleGameCheckMenu(ctx: Context) {
  await ctx.reply(
    "🎮 *Cek ID Game*\n\nPilih game yang ingin kamu cek:",
    { parse_mode: "Markdown", reply_markup: buildGameKeyboard() },
  );
}

// ─── Callback: game:select:TYPENAME ──────────────────────────────────────────
export async function handleGameSelectCallback(
  ctx: Context,
  typeName: string,
) {
  const game = GAME_MAP.get(typeName);
  if (!game) {
    await ctx.answerCallbackQuery({ text: "❌ Game tidak ditemukan." });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => null);

  const userIdLabel = game.userIdLabel ?? "User ID";
  const hint = game.userIdHint ? `\nContoh: \`${game.userIdHint}\`` : "";

  const msg = await ctx.reply(
    `${game.emoji} *${game.displayName}*\n\n` +
      `Kirimkan **${userIdLabel}** kamu:${hint}`,
    { parse_mode: "Markdown" },
  );

  saveGameSession(ctx.chat!.id, {
    typeName,
    stage: "waiting_userId",
    promptMsgId: msg.message_id,
    createdAt: Date.now(),
  });
}

// ─── Callback: game:cancel ────────────────────────────────────────────────────
export async function handleGameCancelCallback(ctx: Context) {
  await ctx.answerCallbackQuery({ text: "❌ Dibatalkan." });
  await ctx.deleteMessage().catch(() => null);
  deleteGameSession(ctx.chat!.id);
}

// ─── Handle free-text input for active game session ──────────────────────────
export async function handleGameTextInput(
  ctx: Context,
): Promise<boolean> {
  const chatId = ctx.chat!.id;
  const session = getGameSession(chatId);
  if (!session) return false;

  const text = ctx.message!.text?.trim() ?? "";
  if (!text) return false;

  const game = GAME_MAP.get(session.typeName)!;

  // ─ Stage 1: waiting for userId ──────────────────────────────────────────
  if (session.stage === "waiting_userId") {
    if (game.needsZoneId) {
      // Ask for Zone ID next
      const zoneLabel = game.zoneIdLabel ?? "Zone ID / Server ID";
      const zoneHint = game.zoneIdHint ? `\nContoh: \`${game.zoneIdHint}\`` : "";

      const msg = await ctx.reply(
        `${game.emoji} *${game.displayName}*\n\n` +
          `✅ User ID: \`${text}\`\n\n` +
          `Sekarang kirimkan **${zoneLabel}** kamu:${zoneHint}`,
        { parse_mode: "Markdown" },
      );

      saveGameSession(chatId, {
        ...session,
        stage: "waiting_zoneId",
        userId: text,
        promptMsgId: msg.message_id,
      });
      return true;
    }

    // No zone ID needed — call API directly
    await callApiAndReply(ctx, session.typeName, text, undefined, game);
    deleteGameSession(chatId);
    return true;
  }

  // ─ Stage 2: waiting for zoneId ──────────────────────────────────────────
  if (session.stage === "waiting_zoneId") {
    await callApiAndReply(ctx, session.typeName, session.userId!, text, game);
    deleteGameSession(chatId);
    return true;
  }

  return false;
}

// ─── API call + formatted reply ───────────────────────────────────────────────
async function callApiAndReply(
  ctx: Context,
  typeName: string,
  userId: string,
  zoneId: string | undefined,
  game: GameDef,
) {
  const statusMsg = await ctx.reply("⏳ Memeriksa ID…");

  try {
    const params = new URLSearchParams({ type_name: typeName, userId });
    if (zoneId) params.set("zoneId", zoneId);

    const res = await fetch(`${API_BASE}/check-id-game?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json()) as {
      status: boolean;
      message?: string;
      nickname?: string;
      username?: string;
      type_name?: string;
    };

    await ctx.api
      .deleteMessage(ctx.chat!.id, statusMsg.message_id)
      .catch(() => null);

    if (data.status) {
      const nickname = data.nickname ?? data.username ?? "—";
      const zoneInfo = zoneId
        ? `\n🌐 *Zone / Server ID:* \`${zoneId}\``
        : "";

      await ctx.reply(
        `✅ *Cek ID Berhasil!*\n\n` +
          `${game.emoji} *Game:* ${game.displayName}\n` +
          `🆔 *User ID:* \`${userId}\`${zoneInfo}\n` +
          `👤 *Nickname:* *${nickname}*\n\n` +
          `_Cek ID lainnya dengan /cekid_`,
        { parse_mode: "Markdown" },
      );
    } else {
      const errMsg = data.message ?? "ID tidak ditemukan atau tidak valid.";
      await ctx.reply(
        `❌ *Cek ID Gagal*\n\n` +
          `${game.emoji} *Game:* ${game.displayName}\n` +
          `🆔 *User ID:* \`${userId}\`\n\n` +
          `⚠️ ${errMsg}\n\n` +
          `_Pastikan User ID${zoneId ? " dan Zone ID" : ""} sudah benar._`,
        { parse_mode: "Markdown" },
      );
    }
  } catch (err) {
    logger.error({ err }, "gameCheck API call failed");
    await ctx.api
      .deleteMessage(ctx.chat!.id, statusMsg.message_id)
      .catch(() => null);
    await ctx.reply(
      "❌ Gagal menghubungi server. Coba lagi beberapa saat.",
    );
  }
}
