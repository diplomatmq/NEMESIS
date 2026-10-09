import { Context } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { gameService } from '../../game/GameService';
import { markdownToTelegramHtml } from '../../game/HealthBar';

export async function handleSuccessfulPayment(ctx: Context) {
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
    const actionResult = await gameService.executeAction(
      {
        telegramUserId: ctx.from.id,
        telegramChatId: pendingPayment.chat_id, // Use original chat ID from pending payment
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      },
      pendingPayment.command,
      true // bypass cooldown
    );

    // Mark payment as completed
    await paymentService.markPaymentCompleted(pendingPayment.id);

    console.log(`✅ Payment processed successfully for user ${ctx.from.id}`);

    // Send success message to the original chat where the action was initiated
    await ctx.api.sendMessage(
      pendingPayment.chat_id,
      markdownToTelegramHtml(
        `✅ Оплата успешна! КД пропущен.\n\n${actionResult.message}`
      ),
      { parse_mode: 'HTML' }
    );

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
