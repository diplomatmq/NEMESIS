import { Context } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { InvoiceService } from '../../payment/InvoiceService';
import { gameService } from '../../game/GameService';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { notifyAdmins } from './admin';

export async function handleSuccessfulPayment(ctx: Context, invoiceService: InvoiceService) {
  if (!ctx.message?.successful_payment || !ctx.from || !ctx.chat) {
    return;
  }

  const payment = ctx.message.successful_payment;
  const telegramPaymentChargeId = payment.telegram_payment_charge_id;
  const payload = payment.invoice_payload;
  const totalAmount = payment.total_amount; // in Stars
  const currency = payment.currency;

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
  // Always approve pre-checkout for Stars payments
  if (ctx.preCheckoutQuery) {
    await ctx.answerPreCheckoutQuery(true);
  }
}
