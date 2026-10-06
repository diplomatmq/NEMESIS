import { db } from '../db';

export interface PendingPayment {
  id: number;
  telegram_user_id: number;
  chat_id: number;
  command: string;
  payload: string;
  invoice_url?: string;
  created_at: Date;
  expires_at: Date;
  status: 'pending' | 'processing' | 'completed' | 'expired';
}

export class PendingPaymentModel {
  static async create(data: {
    telegram_user_id: number;
    chat_id: number;
    command: string;
    invoice_url?: string;
  }): Promise<PendingPayment> {
    const payload = `skipcd:${Date.now()}:${data.telegram_user_id}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const result = await db.query(
      `INSERT INTO pending_payments (telegram_user_id, chat_id, command, payload, invoice_url, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.telegram_user_id, data.chat_id, data.command, payload, data.invoice_url, expiresAt]
    );
    return result.rows[0];
  }

  static async findByPayload(payload: string): Promise<PendingPayment | null> {
    const result = await db.query(
      'SELECT * FROM pending_payments WHERE payload = $1',
      [payload]
    );
    return result.rows[0] || null;
  }

  static async updateStatus(
    id: number,
    status: 'pending' | 'processing' | 'completed' | 'expired'
  ): Promise<void> {
    await db.query(
      'UPDATE pending_payments SET status = $1 WHERE id = $2',
      [status, id]
    );
  }

  static async isValid(payment: PendingPayment): Promise<boolean> {
    if (payment.status !== 'pending') {
      return false;
    }
    if (new Date() > payment.expires_at) {
      await this.updateStatus(payment.id, 'expired');
      return false;
    }
    return true;
  }

  static async markAsProcessing(id: number): Promise<boolean> {
    const result = await db.query(
      `UPDATE pending_payments 
       SET status = 'processing' 
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async cleanupExpired(): Promise<void> {
    await db.query(
      `UPDATE pending_payments 
       SET status = 'expired' 
       WHERE status = 'pending' AND expires_at < NOW()`
    );
  }
}
