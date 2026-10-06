import { Bot, InlineKeyboard } from 'grammy';
import { PendingPaymentModel } from '../database/models/PendingPayment';
import { config } from '../config';

export class InvoiceService {
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  async createSkipCooldownInvoice(
    telegramUserId: number,
    chatId: number,
    command: string
  ): Promise<{ invoiceUrl: string; payload: string; keyboard: InlineKeyboard }> {
    
    // Create pending payment record
    const pendingPayment = await PendingPaymentModel.create({
      telegram_user_id: telegramUserId,
      chat_id: chatId,
      command: command,
    });

    // Create invoice link using Telegram Stars (XTR)
    const invoiceUrl = await this.bot.api.createInvoiceLink(
      'Пропуск КД',
      'Мгновенно выполнить следующее действие',
      pendingPayment.payload,
      '', // provider_token (empty for Telegram Stars)
      'XTR', // currency for Telegram Stars
      [
        {
          label: 'Пропуск КД',
          amount: config.game.starsPrice, // 1 Star
        },
      ]
    );

    // Update pending payment with invoice URL
    await PendingPaymentModel.updateStatus(pendingPayment.id, 'pending');

    // Create inline keyboard with payment button
    const keyboard = new InlineKeyboard().url(
      '⭐ Оплатить 1 Telegram Star',
      invoiceUrl
    );

    return {
      invoiceUrl,
      payload: pendingPayment.payload,
      keyboard,
    };
  }

  async validatePayload(payload: string): Promise<boolean> {
    // Check if payload format is correct
    if (!payload.startsWith('skipcd:')) {
      return false;
    }

    const pendingPayment = await PendingPaymentModel.findByPayload(payload);
    if (!pendingPayment) {
      return false;
    }

    return await PendingPaymentModel.isValid(pendingPayment);
  }
}
