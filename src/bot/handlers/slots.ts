import { Context } from 'grammy';
import { slotMachineService } from '../../game/SlotMachineService';
import { InvoiceService } from '../../payment/InvoiceService';
import { InlineKeyboard } from 'grammy';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { CUSTOM_EMOJI, ce } from '../../game/CustomEmoji';

// Store pending slot requests (user waiting to send spin count)
const pendingSlotRequests = new Map<number, { timestamp: number }>();

// Store active slot sessions waiting for dice
const activeSlotSessions = new Map<number, { sessionId: number; spins: number; timestamp: number }>();

export async function handleSlotsButton(ctx: Context) {
  console.log(`[SLOTS] handleSlotsButton called for user ${ctx.from?.id}, chat type: ${ctx.chat?.type}`);
  
  if (!ctx.from || ctx.chat?.type !== 'private') {
    console.log(`[SLOTS] Rejected: not from user or not private chat`);
    return;
  }

  console.log(`[SLOTS] Checking for existing session...`);
  // Check for active PAID session
  const existingSession = await slotMachineService.getActiveSession(ctx.from.id);
  if (existingSession) {
    console.log(`[SLOTS] Found existing session for user ${ctx.from.id}`);
    await ctx.reply(
      `${ce(CUSTOM_EMOJI.slot, '🎰')} <b>У вас уже есть активная сессия!</b>\n\n` +
      `⏳ Осталось попыток: <b>${existingSession.spins_remaining}</b>\n` +
      `⏰ Истекает: <code>${existingSession.expires_at.toLocaleString('ru-RU')}</code>\n\n` +
      `🎲 Отправьте игровой автомат ${ce(CUSTOM_EMOJI.slot, '🎰')} для прокрутки!`,
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    );
    return;
  }

  console.log(`[SLOTS] No existing session, showing welcome message...`);
  // Mark user as pending slot request
  pendingSlotRequests.set(ctx.from.id, { timestamp: Date.now() });

  const casino = ce(CUSTOM_EMOJI.slot, '🎰');

  await ctx.reply(
    `${casino} <b>Добро пожаловать в Лоты!</b>\n\n` +
    `💫 Крутите слот и выбивайте редкие предметы из инвентаря!\n\n` +
    `❓ <b>Как играть:</b>\n` +
    `${ce(CUSTOM_EMOJI.num1, '1️⃣')} Укажите количество прокруток (например: 10)\n` +
    `${ce(CUSTOM_EMOJI.num2, '2️⃣')} Оплатите инвойс — 2⭐ за прокрутку\n` +
    `${ce(CUSTOM_EMOJI.num3, '3️⃣')} Отправьте слот-автомат ${casino}\n` +
    `${ce(CUSTOM_EMOJI.num4, '4️⃣')} Соберите три одинаковых символа — предмет ваш!\n` +
    `${ce(CUSTOM_EMOJI.num5, '5️⃣')} Джекпот <b>777</b> платит больше всех, но <b>BAR</b>, виноград и лимон тоже дают приз\n\n` +
    `⚠️ <b>Внимание:</b> Пересылка сообщений = <b>-2 попытки</b>\n\n` +
    `✏️ Отправьте количество прокруток:`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }
  );
  console.log(`[SLOTS] Welcome message sent to user ${ctx.from.id}`);
}

export async function handleSlotSpinCount(ctx: Context) {
  if (!ctx.from || !ctx.message?.text || ctx.chat?.type !== 'private') {
    return;
  }

  // Check if user has pending slot request
  const pending = pendingSlotRequests.get(ctx.from.id);
  if (!pending) {
    return; // Not in slot request flow
  }

  // Check timeout (5 minutes)
  if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
    pendingSlotRequests.delete(ctx.from.id);
    return;
  }

  const spins = parseInt(ctx.message.text);
  if (isNaN(spins) || spins < 1 || spins > 100) {
    await ctx.reply(
      `❌ Неверное количество!\n\n` +
      `Укажите число от 1 до 100.`
    );
    return;
  }

  try {
    const { sessionId, starsRequired } = await slotMachineService.createSession(ctx.from.id, spins);

    // Clear pending request
    pendingSlotRequests.delete(ctx.from.id);

    // Create invoice
    const bot = ctx.api;
    const payload = `slot:${sessionId}:${ctx.from.id}`;
    
    const invoiceUrl = await bot.createInvoiceLink(
      `🎰 Лоты (${spins} прокруток)`,
      `Оплата ${spins} прокруток игровых автоматов. 2⭐ за прокрутку.`,
      payload,
      '', // provider_token (empty for Telegram Stars)
      'XTR', // currency for Telegram Stars
      [{ label: 'Прокрутки', amount: starsRequired }]
    );

    // Store session info
    activeSlotSessions.set(ctx.from.id, {
      sessionId,
      spins,
      timestamp: Date.now(),
    });

    await ctx.reply(
      markdownToTelegramHtml(
        `${ce(CUSTOM_EMOJI.gold, '💰')} **Оплатите сессию:**\n\n` +
        `${ce(CUSTOM_EMOJI.slot, '🎰')} Прокруток: **${spins}**\n` +
        `⭐ Стоимость: **${starsRequired} звёзд**\n\n` +
        `После оплаты вы сможете отправить ${spins} игровых автоматов ${ce(CUSTOM_EMOJI.slot, '🎰')}`
      ),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '⭐ Оплатить', url: invoiceUrl }]],
        },
      }
    );

  } catch (error: any) {
    await ctx.reply(`❌ ${error.message || 'Ошибка создания сессии'}`);
  }
}

export async function handleSlotPayment(ctx: Context, payload: string) {
  if (!ctx.from || !ctx.message?.successful_payment) {
    return;
  }

  const match = /^slot:(\d+):(\d+)$/.exec(payload);
  if (!match) {
    return;
  }

  const sessionId = parseInt(match[1]);
  const userId = parseInt(match[2]);

  if (ctx.from.id !== userId) {
    await ctx.reply('❌ Ошибка: несоответствие пользователя');
    return;
  }

  // Verify session exists
  const valid = await slotMachineService.confirmPayment(ctx.from.id, sessionId);
  if (!valid) {
    await ctx.reply('❌ Сессия не найдена или уже использована');
    return;
  }

  const sessionInfo = activeSlotSessions.get(ctx.from.id);
  if (!sessionInfo) {
    await ctx.reply('❌ Ошибка: информация о сессии не найдена');
    return;
  }

  // Record payment stats
  const { paymentService } = await import('../../payment/PaymentService');
  await paymentService.recordPaymentStats({
    telegram_user_id: ctx.from.id,
    username: ctx.from.username,
    first_name: ctx.from.first_name,
    stars_amount: ctx.message.successful_payment.total_amount,
    telegram_payment_charge_id: ctx.message.successful_payment.telegram_payment_charge_id
  });

  await ctx.reply(
    `✅ <b>Оплата принята!</b>\n\n` +
    `${ce(CUSTOM_EMOJI.slot, '🎰')} У вас есть <b>${sessionInfo.spins} попыток</b>\n\n` +
    `⏰ Сессия активна 30 минут\n` +
    `🎯 Соберите три одинаковых символа — джекпот <b>777</b> платит больше всех`,
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
  );

  // Keep session info for 30 minutes
  setTimeout(() => {
    activeSlotSessions.delete(ctx.from!.id);
  }, 30 * 60 * 1000);
}

export async function handleDiceMessage(ctx: Context) {
  if (!ctx.from || !ctx.message?.dice || ctx.chat?.type !== 'private') {
    return;
  }

  // Only process slot machine emoji
  if (ctx.message.dice.emoji !== '🎰') {
    return;
  }

  // Check for forwarded message
  if (ctx.message.forward_origin) {
    const penaltyMessage = await slotMachineService.penalizeForwarded(ctx.from.id);
    await ctx.reply(penaltyMessage, { parse_mode: 'Markdown' });
    return;
  }

  const diceValue = ctx.message.dice.value;

  try {
    const result = await slotMachineService.processDice(ctx.from.id, diceValue);

    if (!result.success) {
      await ctx.reply(result.message);
      return;
    }

    await ctx.reply(result.message, { parse_mode: 'Markdown' });

    // If a win dropped an item, also send item details
    if (result.item) {
      await ctx.reply(
        `🎉 **Поздравляем!**\n\n` +
        `Предмет добавлен в ваш инвентарь!\n` +
        `Проверьте: /status → 🎒 Инвентарь`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error: any) {
    console.error('Error processing dice:', error);
    await ctx.reply(`❌ Ошибка обработки: ${error.message}`);
  }
}

// Cleanup old pending requests periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes

  for (const [userId, data] of pendingSlotRequests.entries()) {
    if (now - data.timestamp > timeout) {
      pendingSlotRequests.delete(userId);
    }
  }

  for (const [userId, data] of activeSlotSessions.entries()) {
    if (now - data.timestamp > 30 * 60 * 1000) {
      activeSlotSessions.delete(userId);
    }
  }
}, 60 * 1000); // Run every minute
