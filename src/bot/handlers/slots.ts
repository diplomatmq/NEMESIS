import { Context } from 'grammy';
import { slotMachineService } from '../../game/SlotMachineService';
import { InvoiceService } from '../../payment/InvoiceService';
import { InlineKeyboard } from 'grammy';

// Store pending slot requests (user waiting to send spin count)
const pendingSlotRequests = new Map<number, { timestamp: number }>();

// Store active slot sessions waiting for dice
const activeSlotSessions = new Map<number, { sessionId: number; spins: number; timestamp: number }>();

export async function handleSlotsButton(ctx: Context) {
  if (!ctx.from || ctx.chat?.type !== 'private') {
    return;
  }

  // Check for active PAID session
  const existingSession = await slotMachineService.getActiveSession(ctx.from.id);
  if (existingSession) {
    await ctx.reply(
      `🎰 **У вас уже есть активная сессия!**\n\n` +
      `⏳ Осталось попыток: **${existingSession.spins_remaining}**\n` +
      `⏰ Истекает: <code>${existingSession.expires_at.toLocaleString('ru-RU')}</code>\n\n` +
      `🎲 Отправьте игровой автомат 🎰 для прокрутки!`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Mark user as pending slot request
  pendingSlotRequests.set(ctx.from.id, { timestamp: Date.now() });

  await ctx.reply(
    `🎰 **Добро пожаловать в Лоты!**\n\n` +
    `💫 Получите шанс выиграть редкие предметы!\n\n` +
    `❓ **Как играть:**\n` +
    `1️⃣ Напишите количество прокруток (например: 10)\n` +
    `2️⃣ Оплатите инвойс (2⭐ за прокрутку)\n` +
    `3️⃣ Отправьте игровые автоматы 🎰\n` +
    `4️⃣ Если выпадет **777** (значение 64) - получите предмет!\n\n` +
    `⚠️ **Внимание:** Пересылка сообщений = **-2 попытки**\n\n` +
    `✏️ Отправьте количество прокруток:`,
    { parse_mode: 'Markdown' }
  );
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
      `💰 **Оплатите сессию:**\n\n` +
      `🎰 Прокруток: **${spins}**\n` +
      `⭐ Стоимость: **${starsRequired} звёзд**\n\n` +
      `После оплаты вы сможете отправить ${spins} игровых автоматов 🎰`,
      {
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
    `✅ **Оплата принята!**\n\n` +
    `🎰 У вас есть **${sessionInfo.spins} попыток**\n\n` +
    `⏰ Сессия активна 30 минут\n` +
    `🎯 Цель: выбить **777** (значение 64)`,
    { parse_mode: 'Markdown' }
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

    // If jackpot, also send item details
    if (result.isJackpot && result.item) {
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
