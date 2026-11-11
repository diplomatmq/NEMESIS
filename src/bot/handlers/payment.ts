import { Context } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { InvoiceService } from '../../payment/InvoiceService';
import { gameService } from '../../game/GameService';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { notifyAdmins } from './admin';
import { db } from '../../database/db';

export async function handleSuccessfulPayment(ctx: Context, invoiceService: InvoiceService) {
  if (!ctx.message?.successful_payment || !ctx.from || !ctx.chat) {
    return;
  }

  const payment = ctx.message.successful_payment;
  const telegramPaymentChargeId = payment.telegram_payment_charge_id;
  const payload = payment.invoice_payload;
  const totalAmount = payment.total_amount; // in Stars
  const currency = payment.currency;

  // Handle miniapp payments (payload starts with "st:")
  if (payload.startsWith('st:')) {
    console.log(`💰 Miniapp payment received from user ${ctx.from.id}: ${totalAmount} ${currency}`);
    await handleMiniappPayment(telegramPaymentChargeId, ctx.from.id, totalAmount, currency, payload);
    return;
  }

  console.log(`💰 Payment received from user ${ctx.from.id}: ${totalAmount} ${currency}`);

  // Process and validate payment
  const validationResult = await paymentService.processSuccessfulPayment(
    telegramPaymentChargeId,
    ctx.from.id,
    ctx.chat.id,
    totalAmount,
    currency,
    payload
  );

  if (!validationResult.valid) {
    console.log(`❌ Payment validation failed: ${validationResult.error}`);
    await ctx.reply(
      `❌ Произошла ошибка при обработке платежа.\n\n` +
      `Причина: ${validationResult.error}\n\n` +
      `Пожалуйста, попробуйте снова или обратитесь в поддержку.`
    );
    return;
  }

  const pendingPayment = validationResult.pendingPayment!;

  try {
    // Execute the saved action automatically
    // IMPORTANT: Use chat_id from pendingPayment, not from payment context
    // because payment notification comes to PM, but action should be executed in original chat
    const sacrificeMatch = /^sacrifice_skip:(mobs|boss)(?::(\d+))?$/.exec(pendingPayment.command);
    const actionResult = sacrificeMatch
      ? { message: await gameService.sacrifice(
          ctx.from.id,
          sacrificeMatch[1] as 'mobs' | 'boss',
          sacrificeMatch[2] ? Number(sacrificeMatch[2]) : undefined,
          true
        ) }
      : await gameService.executeAction(
          {
            telegramUserId: ctx.from.id,
            telegramChatId: pendingPayment.chat_id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
          },
          pendingPayment.command,
          true
        );

    // Mark payment as completed
    await paymentService.markPaymentCompleted(pendingPayment.id);

    // Record payment stats
    await paymentService.recordPaymentStats({
      telegram_user_id: ctx.from.id,
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      stars_amount: totalAmount,
      telegram_payment_charge_id: telegramPaymentChargeId
    });

    console.log(`✅ Payment processed successfully for user ${ctx.from.id}`);

    // Send the result to the original chat, as a reply to the message that
    // started the action (when that message is known).
    const replyTarget = invoiceService.takeReplyTarget(payload);
    const resultText = markdownToTelegramHtml(actionResult.message);
    // Keep the action's buttons (combat or path choice) attached after payment.
    const resultKeyboard = 'keyboard' in actionResult ? actionResult.keyboard : undefined;
    try {
      await ctx.api.sendMessage(pendingPayment.chat_id, resultText, {
        parse_mode: 'HTML',
        reply_markup: resultKeyboard,
        reply_parameters: replyTarget !== undefined ? { message_id: replyTarget } : undefined,
      });
    } catch (sendError) {
      // The original message may have been deleted, which breaks reply delivery.
      // Fall back to a plain message without reply so the result still arrives.
      console.error(`⚠️ Reply delivery failed, retrying without reply:`, sendError);
      await ctx.api.sendMessage(pendingPayment.chat_id, resultText, {
        parse_mode: 'HTML',
        reply_markup: resultKeyboard,
      });
    }

    if ('adminNotification' in actionResult && actionResult.adminNotification) {
      await notifyAdmins(ctx.api, actionResult.adminNotification);
    }

  } catch (error) {
    console.error(`❌ Error executing paid action:`, error);
    await ctx.reply(
      `⚠️ Оплата принята, но возникла ошибка при выполнении действия.\n\n` +
      `Пожалуйста, попробуйте выполнить команду снова.`
    );
  }
}

export async function handlePreCheckoutQuery(ctx: Context) {
  // Handle miniapp payments (payload starts with "st:")
  if (ctx.preCheckoutQuery?.invoice_payload?.startsWith('st:')) {
    const payload = ctx.preCheckoutQuery.invoice_payload;
    const userId = ctx.preCheckoutQuery.from.id;
    const amount = ctx.preCheckoutQuery.total_amount;
    const currency = ctx.preCheckoutQuery.currency;

    console.log(`🔍 Miniapp pre-checkout: user ${userId}, amount ${amount}, payload ${payload}`);

    // Parse payload: "st:uid:amount:timestamp"
    const parts = payload.split(':');
    if (parts.length < 3 || parts[0] !== 'st') {
      console.log(`❌ Invalid miniapp payment payload: ${payload}`);
      await ctx.answerPreCheckoutQuery(false, { error_message: 'Неверный формат платежа' });
      return;
    }

    const payloadUserId = parseInt(parts[1]);
    const payloadAmount = parseInt(parts[2]);

    // Validate
    if (payloadUserId !== userId || payloadAmount !== amount || currency !== 'XTR') {
      console.log(`❌ Miniapp payment validation failed`);
      await ctx.answerPreCheckoutQuery(false, { 
        error_message: 'Не получилось оформить покупку. Открой игру заново и попробуй ещё раз.' 
      });
      return;
    }

    // Check if player exists
    const player = await db.query('SELECT 1 FROM app_players WHERE id = $1', [userId]);
    if (player.rows.length === 0) {
      console.log(`❌ Miniapp player not found: ${userId}`);
      await ctx.answerPreCheckoutQuery(false, { 
        error_message: 'Игрок не найден. Открой игру заново.' 
      });
      return;
    }

    console.log(`✅ Miniapp pre-checkout approved`);
    await ctx.answerPreCheckoutQuery(true);
    return;
  }

  // Always approve pre-checkout for Stars payments (main bot)
  if (ctx.preCheckoutQuery) {
    await ctx.answerPreCheckoutQuery(true);
  }
}


async function handleMiniappPayment(
  chargeId: string,
  userId: number,
  amount: number,
  currency: string,
  payload: string
): Promise<void> {
  try {
    // Check if payment already processed
    const existing = await db.query(
      'SELECT 1 FROM app_star_pay WHERE charge = $1',
      [chargeId]
    );

    if (existing.rows.length > 0) {
      console.log(`⚠️ Miniapp payment already processed: ${chargeId}`);
      return;
    }

    // Parse payload: "st:uid:amount:timestamp"
    const parts = payload.split(':');
    if (parts.length < 3 || parts[0] !== 'st') {
      console.log(`❌ Invalid miniapp payment payload: ${payload}`);
      return;
    }

    const payloadUserId = parseInt(parts[1]);
    const payloadAmount = parseInt(parts[2]);

    // Validate
    if (payloadUserId !== userId) {
      console.log(`❌ User ID mismatch: ${userId} != ${payloadUserId}`);
      return;
    }

    if (payloadAmount !== amount) {
      console.log(`❌ Amount mismatch: ${amount} != ${payloadAmount}`);
      return;
    }

    if (currency !== 'XTR') {
      console.log(`❌ Invalid currency: ${currency}`);
      return;
    }

    const timestamp = Date.now() / 1000;

    // Insert into app_star_pay and app_star_ledger, update app_players
    await db.query('BEGIN');
    
    try {
      // Record payment
      await db.query(
        'INSERT INTO app_star_pay(charge, uid, n, payload, ts, refunded) VALUES($1, $2, $3, $4, $5, 0)',
        [chargeId, userId, amount, payload, timestamp]
      );

      // Add stars to player
      await db.query(
        'UPDATE app_players SET stars = stars + $1 WHERE id = $2',
        [amount, userId]
      );

      // Record in ledger
      await db.query(
        'INSERT INTO app_star_ledger(uid, delta, what, n, ts) VALUES($1, $2, $3, $4, $5)',
        [userId, amount, 'topup', amount, timestamp]
      );

      await db.query('COMMIT');

      console.log(`✅ Miniapp payment processed: user ${userId} received ${amount} stars`);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error(`❌ Error processing miniapp payment:`, error);
  }
}
