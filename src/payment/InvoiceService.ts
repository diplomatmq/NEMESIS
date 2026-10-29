import { Bot, InlineKeyboard } from 'grammy';
import { PendingPaymentModel } from '../database/models/PendingPayment';
import { config } from '../config';

/** A stored reply target stays relevant as long as the pending payment. */
const REPLY_TARGET_TTL_MS = 15 * 60 * 1000;

export class InvoiceService {
  private bot: Bot;
  private replyTargets = new Map<string, { messageId: number; expiresAt: number }>();

  constructor(bot: Bot) {
    this.bot = bot;
  }

  async createSkipCooldownInvoice(options: {
    telegramUserId: number;
    chatId: number;
    command: string;
    amount?: number;
    title?: string;
    replyToMessageId?: number;
  }): Promise<{ invoiceUrl: string; payload: string; keyboard: InlineKeyboard }> {
    const { telegramUserId, chatId, command, replyToMessageId } = options;
    const amount = options.amount ?? config.game.starsPrice;
    const title = options.title ?? 'Пропуск КД';

    // Create pending payment record
    const pendingPayment = await PendingPaymentModel.create({
      telegram_user_id: telegramUserId,
      chat_id: chatId,
      command: command,
    });

    if (replyToMessageId !== undefined) {
      this.rememberReplyTarget(pendingPayment.payload, replyToMessageId);
    }

    // Create invoice link using Telegram Stars (XTR)
    const invoiceUrl = await this.bot.api.createInvoiceLink(
      title,
      'Мгновенно выполнить действие',
      pendingPayment.payload,
      '', // provider_token (empty for Telegram Stars)
      'XTR', // currency for Telegram Stars
      [
        {
          label: title,
          amount,
        },
      ]
    );

    // Update pending payment with invoice URL
    await PendingPaymentModel.updateStatus(pendingPayment.id, 'pending');

    // Create inline keyboard with payment button
    const keyboard = new InlineKeyboard().url(
      `⭐ Оплатить ${amount} Telegram Stars`,
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

  /**
   * Remember which message the paid result should reply to. The target lives in
   * memory only: it is a display detail, so losing it on restart at worst means
   * the result arrives without a reply.
   */
  private rememberReplyTarget(payload: string, messageId: number): void {
    const now = Date.now();
    for (const [key, target] of this.replyTargets) {
      if (target.expiresAt <= now) {
        this.replyTargets.delete(key);
      }
    }
    this.replyTargets.set(payload, { messageId, expiresAt: now + REPLY_TARGET_TTL_MS });
  }

  /** Consume the reply target for a payload, if one was stored. */
  takeReplyTarget(payload: string): number | undefined {
    const target = this.replyTargets.get(payload);
    if (!target) {
      return undefined;
    }
    this.replyTargets.delete(payload);
    return target.messageId;
  }
}
