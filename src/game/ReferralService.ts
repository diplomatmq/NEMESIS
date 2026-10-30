import { db } from '../database/db';

/** Minimum balance (in Stars) required to request a payout. */
export const MIN_WITHDRAWAL = 1000;

/** Telegram ID of the administrator who reviews payout requests. */
export const REFERRAL_ADMIN_ID = 793216884;

export interface ReferralChat {
  id: number;
  owner_telegram_id: number;
  chat_telegram_id: number;
  percent: number;
  created_at: Date;
}

export interface ReferralStatus extends ReferralChat {
  revenue: number;
  accrued: number;
  withdrawn: number;
  balance: number;
  has_pending: boolean;
}

function mapReferral(row: any): ReferralChat {
  return {
    id: Number(row.id),
    owner_telegram_id: Number(row.owner_telegram_id),
    chat_telegram_id: Number(row.chat_telegram_id),
    percent: Number(row.percent),
    created_at: row.created_at,
  };
}

export class ReferralService {
  /** Creates a referral chat or updates the owner/percent of an existing one. */
  async upsert(ownerTelegramId: number, chatTelegramId: number, percent: number): Promise<ReferralChat> {
    const result = await db.query(
      `INSERT INTO referral_chats (owner_telegram_id, chat_telegram_id, percent)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_telegram_id) DO UPDATE SET
         owner_telegram_id = EXCLUDED.owner_telegram_id,
         percent = EXCLUDED.percent
       RETURNING *`,
      [ownerTelegramId, chatTelegramId, percent]
    );
    return mapReferral(result.rows[0]);
  }

  async findById(id: number): Promise<ReferralChat | null> {
    const result = await db.query('SELECT * FROM referral_chats WHERE id = $1', [id]);
    return result.rows[0] ? mapReferral(result.rows[0]) : null;
  }

  /** Stars spent by players inside the chat since the referral was created. */
  private async getRevenue(chatTelegramId: number, since: Date): Promise<number> {
    const result = await db.query(
      `SELECT COALESCE(SUM(p.amount), 0)::int AS total
       FROM payments p
       JOIN pending_payments pp ON pp.id = p.pending_payment_id
       WHERE pp.chat_id = $1 AND p.currency = 'XTR' AND p.created_at >= $2`,
      [chatTelegramId, since]
    );
    return Number(result.rows[0].total);
  }

  private async getWithdrawn(referralChatId: number): Promise<number> {
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total
       FROM referral_withdrawals
       WHERE referral_chat_id = $1 AND status = 'approved'`,
      [referralChatId]
    );
    return Number(result.rows[0].total);
  }

  private async hasPending(referralChatId: number): Promise<boolean> {
    const result = await db.query(
      `SELECT 1 FROM referral_withdrawals
       WHERE referral_chat_id = $1 AND status = 'pending' LIMIT 1`,
      [referralChatId]
    );
    return result.rows.length > 0;
  }

  async getStatus(referral: ReferralChat): Promise<ReferralStatus> {
    const revenue = await this.getRevenue(referral.chat_telegram_id, referral.created_at);
    const withdrawn = await this.getWithdrawn(referral.id);
    const pending = await this.hasPending(referral.id);
    const accrued = Math.floor((revenue * referral.percent) / 100);
    const balance = Math.max(0, accrued - withdrawn);
    return { ...referral, revenue, accrued, withdrawn, balance, has_pending: pending };
  }

  async getStatusesForOwner(ownerTelegramId: number): Promise<ReferralStatus[]> {
    const result = await db.query(
      'SELECT * FROM referral_chats WHERE owner_telegram_id = $1 ORDER BY created_at',
      [ownerTelegramId]
    );
    const statuses: ReferralStatus[] = [];
    for (const row of result.rows) {
      statuses.push(await this.getStatus(mapReferral(row)));
    }
    return statuses;
  }

  async getAllStatuses(): Promise<ReferralStatus[]> {
    const result = await db.query('SELECT * FROM referral_chats ORDER BY created_at');
    const statuses: ReferralStatus[] = [];
    for (const row of result.rows) {
      statuses.push(await this.getStatus(mapReferral(row)));
    }
    return statuses;
  }

  /** Total Stars owed to chat owners (their current unpaid balances). */
  async getTotalObligations(): Promise<number> {
    const statuses = await this.getAllStatuses();
    return statuses.reduce((sum, status) => sum + status.balance, 0);
  }

  async requestWithdrawal(referralId: number): Promise<{
    success: boolean;
    message: string;
    amount?: number;
    withdrawalId?: number;
    ownerTelegramId?: number;
  }> {
    const referral = await this.findById(referralId);
    if (!referral) {
      return { success: false, message: 'Реферальный чат не найден.' };
    }

    const status = await this.getStatus(referral);
    if (status.has_pending) {
      return { success: false, message: 'Запрос на вывод уже отправлен и ожидает одобрения.' };
    }
    if (status.balance < MIN_WITHDRAWAL) {
      return { success: false, message: `Минимум для вывода: ${MIN_WITHDRAWAL} ⭐.` };
    }

    const result = await db.query(
      `INSERT INTO referral_withdrawals (referral_chat_id, amount) VALUES ($1, $2) RETURNING id`,
      [referral.id, status.balance]
    );

    return {
      success: true,
      message: 'Запрос на вывод отправлен администратору.',
      amount: status.balance,
      withdrawalId: Number(result.rows[0].id),
      ownerTelegramId: referral.owner_telegram_id,
    };
  }

  async approveWithdrawal(withdrawalId: number): Promise<{
    success: boolean;
    message: string;
    amount?: number;
    ownerTelegramId?: number;
  }> {
    const result = await db.query(
      `UPDATE referral_withdrawals
       SET status = 'approved', resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING amount, referral_chat_id`,
      [withdrawalId]
    );

    if (result.rows.length === 0) {
      return { success: false, message: 'Запрос уже обработан или не найден.' };
    }

    const referral = await this.findById(Number(result.rows[0].referral_chat_id));
    return {
      success: true,
      message: 'Вывод одобрен.',
      amount: Number(result.rows[0].amount),
      ownerTelegramId: referral ? referral.owner_telegram_id : undefined,
    };
  }
}

export const referralService = new ReferralService();
