import { Context } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { gameService } from '../../game/GameService';

export async function handleSuccessfulPayment(ctx: Context) {
  if (!ctx.message?.successful_payment || !ctx.from || !ctx.chat) {
    return;
  }

  const payment = ctx.message.successful_payment;
  const telegramPaymentChargeId = payment.telegram_payment_charge_id;
  const payload = payment.invoice_payload;
  const totalAmount = payment.total_amount; // in Stars
  const currency = payment.currency;

  console.log('Payment received:', {
    chargeId: telegramPaymentChargeId,
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    amount: totalAmount,
    currency,
    payload,
  });

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
    console.error('Payment validation failed:', validationResult.error);
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
    const actionResult = await gameService.executeAction(
      {
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      },
      pendingPayment.command,
      true // bypass cooldown
    );

    // Mark payment as completed
    await paymentService.markPaymentCompleted(pendingPayment.id);

    // Send success message
    await ctx.reply(
      `✅ Оплата успешна! КД пропущен.\n\n` +
      actionResult.message
    );

  } catch (error) {
    console.error('Error executing paid action:', error);
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
