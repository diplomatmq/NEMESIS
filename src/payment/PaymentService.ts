import { db } from '../database/db';
import { PendingPaymentModel, PendingPayment } from '../database/models/PendingPayment';

export interface PaymentValidationResult {
  valid: boolean;
  pendingPayment?: PendingPayment;
  error?: string;
}

export class PaymentService {
  async processSuccessfulPayment(
    telegramPaymentChargeId: string,
    telegramUserId: number,
    telegramChatId: number,
    amount: number,
    currency: string,
    payload: string
  ): Promise<PaymentValidationResult> {
    
    // Check if payment already processed (idempotency)
    const existingPayment = await this.findByChargeId(telegramPaymentChargeId);
    if (existingPayment) {
      return {
        valid: false,
        error: 'Payment already processed',
      };
    }

    // Find pending payment
    const pendingPayment = await PendingPaymentModel.findByPayload(payload);
    if (!pendingPayment) {
      return {
        valid: false,
        error: 'Pending payment not found',
      };
    }

    console.log('Pending payment found:', {
      id: pendingPayment.id,
      stored_user_id: pendingPayment.telegram_user_id,
      received_user_id: telegramUserId,
      stored_chat_id: pendingPayment.chat_id,
      received_chat_id: telegramChatId,
      status: pendingPayment.status,
    });

    // Validate payment details
    if (!await PendingPaymentModel.isValid(pendingPayment)) {
      return {
        valid: false,
        error: 'Payment expired or already used',
      };
    }

    // Only validate user ID - chat ID will differ (payment comes to PM, but action was in group)
    if (pendingPayment.telegram_user_id !== telegramUserId) {
      console.error('User ID mismatch:', {
        expected: pendingPayment.telegram_user_id,
        received: telegramUserId,
        expectedType: typeof pendingPayment.telegram_user_id,
        receivedType: typeof telegramUserId,
      });
      return {
        valid: false,
        error: 'User mismatch',
      };
    }

    // NOTE: We don't validate chat_id because:
    // - Payment notification always comes to PM (telegramChatId = user's ID)
    // - But the game action was performed in a group chat (pendingPayment.chat_id = group ID)
    // - We need to execute the action in the original chat where the invoice was created

    if (currency !== 'XTR') {
      return {
        valid: false,
        error: 'Invalid currency',
      };
    }

    if (amount !== 1) {
      return {
        valid: false,
        error: 'Invalid amount',
      };
    }

    // Try to mark as processing (prevents race conditions)
    const marked = await PendingPaymentModel.markAsProcessing(pendingPayment.id);
    if (!marked) {
      return {
        valid: false,
        error: 'Payment already being processed',
      };
    }

    // Save payment record
    await this.savePayment({
      telegram_payment_charge_id: telegramPaymentChargeId,
      telegram_user_id: telegramUserId,
      chat_id: telegramChatId,
      amount,
      currency,
      payload,
      pending_payment_id: pendingPayment.id,
    });

    return {
      valid: true,
      pendingPayment,
    };
  }

  private async findByChargeId(chargeId: string): Promise<any> {
    const result = await db.query(
      'SELECT * FROM payments WHERE telegram_payment_charge_id = $1',
      [chargeId]
    );
    return result.rows[0] || null;
  }

  private async savePayment(data: {
    telegram_payment_charge_id: string;
    telegram_user_id: number;
    chat_id: number;
    amount: number;
    currency: string;
    payload: string;
    pending_payment_id: number;
  }): Promise<void> {
    await db.query(
      `INSERT INTO payments (
        telegram_payment_charge_id, 
        telegram_user_id, 
        chat_id, 
        amount, 
        currency, 
        payload, 
        pending_payment_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        data.telegram_payment_charge_id,
        data.telegram_user_id,
        data.chat_id,
        data.amount,
        data.currency,
        data.payload,
        data.pending_payment_id,
      ]
    );
  }

  async markPaymentCompleted(pendingPaymentId: number): Promise<void> {
    await PendingPaymentModel.updateStatus(pendingPaymentId, 'completed');
  }
}

export const paymentService = new PaymentService();
