import { Context, InlineKeyboard } from 'grammy';
import { referralService, MIN_WITHDRAWAL, HOLD_DAYS, REFERRAL_ADMIN_ID } from '../../game/ReferralService';
import type { ReferralStatus } from '../../game/ReferralService';
import { ADMIN_IDS } from './admin';

interface NewRefDraft {
  step: 'owner' | 'chat' | 'percent';
  ownerTelegramId?: number;
  chatTelegramId?: number;
  timestamp: number;
}

// Admins that are currently configuring a new referral chat via /new_ref.
const pendingNewRef = new Map<number, NewRefDraft>();
const DRAFT_TTL_MS = 5 * 60 * 1000;

/** /new_ref — step-by-step setup of a referral chat (private chat, admins only). */
export async function handleNewRef(ctx: Context) {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('⚠️ Команда /new_ref работает только в личных сообщениях с ботом.');
    return;
  }

  pendingNewRef.set(ctx.from.id, { step: 'owner', timestamp: Date.now() });
  await ctx.reply('🆕 Новый реферальный чат.\n\nШаг 1/3: отправьте Telegram ID владельца чата.');
}

/** Consumes the admin's answers during the /new_ref wizard. */
export async function handleReferralTextInput(ctx: Context): Promise<boolean> {
  if (!ctx.from || !ctx.message?.text || ctx.chat?.type !== 'private') {
    return false;
  }

  const draft = pendingNewRef.get(ctx.from.id);
  if (!draft) {
    return false;
  }

  if (Date.now() - draft.timestamp > DRAFT_TTL_MS) {
    pendingNewRef.delete(ctx.from.id);
    return false;
  }

  const text = ctx.message.text.trim();

  if (draft.step === 'owner' || draft.step === 'chat') {
    const id = Number(text);
    if (!Number.isInteger(id)) {
      await ctx.reply('❌ Некорректный ID. Отправьте числовой Telegram ID.');
      return true;
    }

    if (draft.step === 'owner') {
      draft.ownerTelegramId = id;
      draft.step = 'chat';
      draft.timestamp = Date.now();
      await ctx.reply('Шаг 2/3: отправьте Telegram ID самого чата (например -1001234567890).');
    } else {
      draft.chatTelegramId = id;
      draft.step = 'percent';
      draft.timestamp = Date.now();
      await ctx.reply('Шаг 3/3: укажите процент, который получает владелец чата (например 10).');
    }
    return true;
  }

  const percent = Number(text.replace(',', '.'));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    await ctx.reply('❌ Некорректный процент. Введите число от 0 до 100.');
    return true;
  }

  pendingNewRef.delete(ctx.from.id);
  try {
    const referral = await referralService.upsert(
      draft.ownerTelegramId!,
      draft.chatTelegramId!,
      percent
    );
    await ctx.reply(
      `✅ Реферальная система настроена.\n\n` +
        `👤 Владелец: ${referral.owner_telegram_id}\n` +
        `💬 Чат: ${referral.chat_telegram_id}\n` +
        `📈 Процент: ${referral.percent}%`
    );
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка сохранения: ${error.message || 'Неизвестная ошибка'}`);
  }
  return true;
}

function buildRefView(statuses: ReferralStatus[]): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  let text = '📈 Реферальная статистика\n\n';

  for (const status of statuses) {
    text += `💬 Чат: ${status.chat_telegram_id}\n`;
    text += `📊 Процент: ${status.percent}%\n`;
    text += `💰 Накоплено: ${status.accrued} ⭐\n`;
    if (status.held > 0) {
      text += `🔒 На удержании (${HOLD_DAYS} дн.): ${status.held} ⭐\n`;
    }
    text += `✅ Доступно к выводу: ${status.balance} ⭐\n`;
    if (status.has_pending) {
      text += '⏳ Запрос на вывод ожидает одобрения\n';
    }
    text += '\n';

    if (status.balance >= MIN_WITHDRAWAL && !status.has_pending) {
      keyboard.text(`💸 Вывод (${status.balance} ⭐)`, `ref:withdraw:${status.id}`).row();
    }
  }

  if (keyboard.inline_keyboard.length === 0) {
    text += `ℹ️ Минимум для вывода: ${MIN_WITHDRAWAL} ⭐`;
  }

  return { text, keyboard };
}

/** /ref — referral stats for the chat owner, with a payout button. */
export async function handleRef(ctx: Context) {
  if (!ctx.from) {
    return;
  }

  const statuses = await referralService.getStatusesForOwner(ctx.from.id);
  if (statuses.length === 0) {
    await ctx.reply('ℹ️ У вас нет реферальных чатов.');
    return;
  }

  const { text, keyboard } = buildRefView(statuses);
  await ctx.reply(text, {
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

/** Handles the payout button and the admin approve button. */
export async function handleReferralCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    return;
  }

  const data = ctx.callbackQuery.data;
  const withdrawMatch = /^ref:withdraw:(\d+)$/.exec(data);
  const approveMatch = /^ref:approve:(\d+)$/.exec(data);
  if (!withdrawMatch && !approveMatch) {
    return;
  }

  if (withdrawMatch) {
    const referralId = Number(withdrawMatch[1]);
    const referral = await referralService.findById(referralId);
    if (!referral) {
      await ctx.answerCallbackQuery('Реферальный чат не найден.');
      return;
    }
    if (referral.owner_telegram_id !== ctx.from.id) {
      await ctx.answerCallbackQuery('❌ Это не ваш чат.');
      return;
    }

    const result = await referralService.requestWithdrawal(referralId);
    if (!result.success) {
      await ctx.answerCallbackQuery(result.message);
      return;
    }

    await ctx.answerCallbackQuery('Запрос отправлен');

    const requester = ctx.from.username
      ? `@${ctx.from.username}`
      : ctx.from.first_name || `id ${ctx.from.id}`;

    try {
      await ctx.api.sendMessage(
        REFERRAL_ADMIN_ID,
        `💸 Запрос на вывод\n\n` +
          `${requester} (${ctx.from.id}) запросил вывод ${result.amount} ⭐\n` +
          `💬 Чат: ${referral.chat_telegram_id}\n` +
          `📊 Процент: ${referral.percent}%`,
        {
          reply_markup: new InlineKeyboard().text('✅ Одобрить', `ref:approve:${result.withdrawalId}`),
          link_preview_options: { is_disabled: true },
        }
      );
    } catch (error) {
      console.error('❌ Failed to notify referral admin:', error);
    }

    const statuses = await referralService.getStatusesForOwner(ctx.from.id);
    const { text, keyboard } = buildRefView(statuses);
    await ctx
      .editMessageText(text, { reply_markup: keyboard, link_preview_options: { is_disabled: true } })
      .catch(() => {});
    return;
  }

  if (ctx.from.id !== REFERRAL_ADMIN_ID) {
    await ctx.answerCallbackQuery('❌ Только администратор может одобрить вывод.');
    return;
  }

  const withdrawalId = Number(approveMatch![1]);
  const result = await referralService.approveWithdrawal(withdrawalId);
  if (!result.success) {
    await ctx.answerCallbackQuery(result.message);
    return;
  }

  await ctx.answerCallbackQuery('Одобрено');
  await ctx.editMessageText(`✅ Вывод ${result.amount} ⭐ одобрен.`).catch(() => {});

  if (result.ownerTelegramId) {
    try {
      await ctx.api.sendMessage(
        result.ownerTelegramId,
        `✅ Ваш вывод ${result.amount} ⭐ одобрен.`,
        { link_preview_options: { is_disabled: true } }
      );
    } catch (error) {
      console.error('❌ Failed to notify referral owner:', error);
    }
  }
}
