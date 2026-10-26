import { db } from '../database/db';
import { PendingPaymentModel, PendingPayment } from '../database/models/PendingPayment';
import { BossPin } from '../database/models/PlayerProgress';

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
      console.log(`❌ Pending payment not found for payload: ${payload}`);
      return {
        valid: false,
        error: 'Pending payment not found',
      };
    }

    console.log(`✅ Payment validated for user ${telegramUserId} in chat ${pendingPayment.chat_id}`);

    // Validate payment details
    if (!await PendingPaymentModel.isValid(pendingPayment)) {
      return {
        valid: false,
        error: 'Payment expired or already used',
      };
    }

    // Only validate user ID - chat ID will differ (payment comes to PM, but action was in group)
    // Convert both to numbers for comparison (PostgreSQL BIGINT returns as string)
    if (Number(pendingPayment.telegram_user_id) !== telegramUserId) {
      console.log(`❌ Payment validation failed: User mismatch (expected ${pendingPayment.telegram_user_id}, got ${telegramUserId})`);
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

    const expectedAmount = pendingPayment.command.startsWith('sacrifice_skip:')
      ? 5
      : 1;
    if (amount !== expectedAmount) {
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

  async recordPaymentStats(data: {
    telegram_user_id: number;
    username?: string;
    first_name?: string;
    stars_amount: number;
    telegram_payment_charge_id: string;
  }): Promise<void> {
    try {
      await db.query(
        `INSERT INTO payment_stats (
          telegram_user_id,
          username,
          first_name,
          stars_amount,
          telegram_payment_charge_id
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (telegram_payment_charge_id) DO NOTHING`,
        [
          data.telegram_user_id,
          data.username,
          data.first_name,
          data.stars_amount,
          data.telegram_payment_charge_id,
        ]
      );
      console.log(`📊 Payment stats recorded: ${data.stars_amount} stars from user ${data.telegram_user_id}`);
    } catch (error) {
      console.error('❌ Failed to record payment stats:', error);
    }
  }

  async getDatabaseStats(): Promise<{
    totalPlayers: number;
    totalChats: number;
    totalStars: number;
    sounShare: number;
    egorShare: number;
  }> {
    // Get total players
    const playersResult = await db.query('SELECT COUNT(DISTINCT id) as count FROM users');
    const totalPlayers = parseInt(playersResult.rows[0].count);

    // Get total chats (excluding private chats)
    const chatsResult = await db.query(
      `SELECT COUNT(DISTINCT id) as count FROM chats WHERE chat_type != 'private'`
    );
    const totalChats = parseInt(chatsResult.rows[0].count);

    // Get total stars
    const starsResult = await db.query('SELECT COALESCE(SUM(stars_amount), 0) as total FROM payment_stats');
    const totalStars = parseInt(starsResult.rows[0].total);

    // Calculate shares
    const sounShare = Math.floor(totalStars * 0.75);
    const egorShare = Math.floor(totalStars * 0.25);

    return {
      totalPlayers,
      totalChats,
      totalStars,
      sounShare,
      egorShare,
    };
  }

  async getGlobalTopPlayers(limit: number = 5): Promise<Array<{
    rank: number;
    telegram_id: number;
    username?: string;
    first_name?: string;
    floor: number;
    total_attack: number;
    class_name: string;
    active_pin?: BossPin | null;
  }>> {
    const result = await db.query(
      `SELECT 
        ROW_NUMBER() OVER (ORDER BY pp.highest_floor_reached DESC, pp.attack DESC) as rank,
        u.telegram_id,
        u.username,
        u.first_name,
        pp.highest_floor_reached as floor,
        pp.attack as total_attack,
        pp.active_pin,
        COALESCE(c.name, 'Без класса') as class_name
      FROM player_progress pp
      JOIN users u ON pp.user_id = u.id
      LEFT JOIN classes c ON pp.class_id = c.id
      WHERE pp.season_id = (SELECT id FROM seasons WHERE is_current = true)
      ORDER BY pp.highest_floor_reached DESC, pp.attack DESC
      LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async getChatTopPlayers(chatId: number, limit: number = 5): Promise<Array<{
    rank: number;
    telegram_id: number;
    username?: string;
    first_name?: string;
    floor: number;
    total_attack: number;
    class_name: string;
    active_pin?: BossPin | null;
  }>> {
    const result = await db.query(
      `SELECT 
        ROW_NUMBER() OVER (ORDER BY pp.highest_floor_reached DESC, pp.attack DESC) as rank,
        u.telegram_id,
        u.username,
        u.first_name,
        pp.highest_floor_reached as floor,
        pp.attack as total_attack,
        pp.active_pin,
        COALESCE(c.name, 'Без класса') as class_name
      FROM player_progress pp
      JOIN users u ON pp.user_id = u.id
      LEFT JOIN classes c ON pp.class_id = c.id
      JOIN combat_state cs ON pp.user_id = cs.user_id AND pp.season_id = cs.season_id
      WHERE pp.season_id = (SELECT id FROM seasons WHERE is_current = true)
        AND cs.chat_id = $1
      ORDER BY pp.highest_floor_reached DESC, pp.attack DESC
      LIMIT $2`,
      [chatId, limit]
    );
    return result.rows;
  }
}

export const paymentService = new PaymentService();
