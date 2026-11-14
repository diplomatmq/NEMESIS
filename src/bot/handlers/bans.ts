import { Context } from 'grammy';
import { ADMIN_IDS } from './admin';
import { BanModel, PlayerBan } from '../../database/models/Ban';
import { UserModel } from '../../database/models/User';

/** Moscow has no daylight saving time, so the offset is a constant +03:00. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Reason length is capped so a pasted text cannot bloat the /goblins list. */
const REASON_MAX_LENGTH = 100;

/** Moscow wall-clock label, same format as the one used by season messages. */
function formatMsk(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()} ` +
    `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())} МСК`;
}

/** End of the block as shown in the messages: "до <дата>" or "бессрочно". */
function formatUntil(ban: PlayerBan): string {
  return ban.banned_until ? `до ${formatMsk(new Date(ban.banned_until))}` : 'бессрочно';
}

function displayName(ban: PlayerBan): string {
  if (ban.username) return `@${ban.username}`;
  if (ban.first_name) return ban.first_name;
  return String(ban.telegram_id);
}

const DURATION_RE = /^(\d+)([mhd])$/i;
const DURATION_UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parses "30m" / "2h" / "7d"; returns null for anything else. */
function parseDuration(value: string): number | null {
  const match = DURATION_RE.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (amount <= 0) {
    return null;
  }
  return amount * DURATION_UNIT_MS[match[2].toLowerCase()];
}

/**
 * Resolves "@ник" or a numeric id to the data stored with the ban. A nickname
 * cannot be resolved without the database row, a numeric id can be blocked
 * even when the player has never written to the bot.
 */
async function resolveTarget(
  argument: string
): Promise<{ telegramId: number; username: string | null; firstName: string | null } | null> {
  if (argument.startsWith('@')) {
    const user = await UserModel.findByUsername(argument.slice(1));
    if (!user) {
      return null;
    }
    return {
      telegramId: Number(user.telegram_id),
      username: user.username ?? null,
      firstName: user.first_name ?? null,
    };
  }

  const telegramId = Number(argument);
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return null;
  }

  const user = await UserModel.findByTelegramId(telegramId);
  return {
    telegramId,
    username: user?.username ?? null,
    firstName: user?.first_name ?? null,
  };
}

/**
 * /ban @ник|ID [срок] причина — blocks a player. Without a duration the block
 * is permanent. Administrators only.
 */
export async function handleBan(ctx: Context) {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  const replyOptions = { reply_to_message_id: ctx.message?.message_id };
  const args = (ctx.message?.text ?? '').split(/\s+/).slice(1);

  if (args.length < 2) {
    await ctx.reply(
      'Использование: /ban @ник|ID [срок] причина\n' +
      'Срок: 30m, 2h, 7d, 30d — без срока блокировка бессрочная\n' +
      'Пример: /ban @nick 7d спам',
      replyOptions
    );
    return;
  }

  const target = await resolveTarget(args[0]);
  if (!target) {
    await ctx.reply('❌ Игрок не найден в базе данных.', replyOptions);
    return;
  }

  if (ADMIN_IDS.includes(target.telegramId)) {
    await ctx.reply('❌ Нельзя заблокировать администратора.', replyOptions);
    return;
  }

  const durationMs = parseDuration(args[1]);
  const reason = (durationMs === null ? args.slice(1) : args.slice(2))
    .join(' ')
    .trim()
    .slice(0, REASON_MAX_LENGTH);

  if (!reason) {
    await ctx.reply('❌ Укажите причину блокировки.', replyOptions);
    return;
  }

  try {
    const ban = await BanModel.upsert({
      telegramId: target.telegramId,
      username: target.username,
      firstName: target.firstName,
      reason,
      bannedBy: ctx.from.id,
      until: durationMs === null ? null : new Date(Date.now() + durationMs),
    });

    await ctx.reply(
      `👺 ${displayName(ban)} заблокирован (${formatUntil(ban)})\nПричина: ${reason}`,
      replyOptions
    );
  } catch (error: any) {
    console.error('❌ Error banning player:', error);
    await ctx.reply(`❌ Ошибка блокировки: ${error.message || 'Неизвестная ошибка'}`, replyOptions);
  }
}

/**
 * /unban @ник|ID — lifts the block of a player, including permanent ones.
 * Administrators only.
 */
export async function handleUnban(ctx: Context) {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  const replyOptions = { reply_to_message_id: ctx.message?.message_id };
  const args = (ctx.message?.text ?? '').split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply('Использование: /unban @ник|ID', replyOptions);
    return;
  }

  try {
    const target = await resolveTarget(args[0]);
    if (!target) {
      await ctx.reply('❌ Игрок не найден в базе данных.', replyOptions);
      return;
    }

    const removed = await BanModel.remove(target.telegramId);
    const name = target.username ? `@${target.username}` : String(target.telegramId);

    await ctx.reply(
      removed ? `✅ Блокировка с игрока ${name} снята.` : 'ℹ️ Этот игрок не был заблокирован.',
      replyOptions
    );
  } catch (error: any) {
    console.error('❌ Error unbanning player:', error);
    await ctx.reply(`❌ Ошибка снятия блокировки: ${error.message || 'Неизвестная ошибка'}`, replyOptions);
  }
}

/** /goblins — public list of blocked players. Available to everyone. */
export async function handleGoblins(ctx: Context) {
  const replyOptions = { reply_to_message_id: ctx.message?.message_id };

  try {
    const bans = await BanModel.listActive();

    if (bans.length === 0) {
      await ctx.reply('👺 Заблокированных игроков нет.', replyOptions);
      return;
    }

    const lines = bans.map(
      (ban, index) => `${index + 1}. ${displayName(ban)} — ${formatUntil(ban)} — ${ban.reason || 'без причины'}`
    );

    await ctx.reply(
      `👺 Заблокированные игроки\n\n${lines.join('\n')}\n\nВсего: ${bans.length}`,
      replyOptions
    );
  } catch (error: any) {
    console.error('❌ Error listing bans:', error);
    await ctx.reply('❌ Не удалось получить список блокировок.', replyOptions);
  }
}

const GOBLINS_COMMAND_RE = /^\/?(goblins|гоблины)(@[\w_]+)?$/i;
const COMBAT_TEXT_RE = /^(атака|атаковать|удар|attack|a|защита|защититься|блок|defend|block|d)$/i;

/**
 * Gameplay updates are the ones a block has to stop: buttons, commands and the
 * combat words players type. Plain chatter is left alone, because the bot
 * cannot moderate a group chat anyway.
 */
function isGameplayUpdate(ctx: Context): boolean {
  if (ctx.callbackQuery) {
    return true;
  }

  const text = (ctx.message?.text ?? '').trim();
  if (!text) {
    return false;
  }

  if (text.startsWith('/')) {
    return true;
  }

  return COMBAT_TEXT_RE.test(text) || /^\d+$/.test(text) || ctx.message?.dice !== undefined;
}

/**
 * Registered before every command and action handler: a blocked player only
 * keeps access to the public /goblins list.
 */
export async function handleBannedUser(ctx: Context, next: () => Promise<void>) {
  const from = ctx.from;
  if (!from || ADMIN_IDS.includes(from.id) || !isGameplayUpdate(ctx)) {
    return next();
  }

  const text = (ctx.message?.text ?? '').trim();
  if (GOBLINS_COMMAND_RE.test(text)) {
    return next();
  }

  let ban: PlayerBan | null;
  try {
    ban = await BanModel.getActive(from.id);
  } catch (error) {
    console.error('❌ Ban check failed:', error);
    return next();
  }

  if (!ban) {
    return next();
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: `🚫 Вы заблокированы (${formatUntil(ban)})`,
      show_alert: true,
    });
    return;
  }

  await ctx.reply(
    `🚫 Вы заблокированы (${formatUntil(ban)})\nПричина: ${ban.reason || 'не указана'}`,
    { reply_to_message_id: ctx.message?.message_id }
  );
}
