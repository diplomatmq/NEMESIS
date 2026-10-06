import { db } from '../db';

export interface User {
  id: number;
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  created_at: Date;
  last_start_at?: Date;
  is_active: boolean;
}

export class UserModel {
  static async findByTelegramId(telegramId: number): Promise<User | null> {
    const result = await db.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    telegram_id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<User> {
    const result = await db.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name, last_start_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [data.telegram_id, data.username, data.first_name, data.last_name]
    );
    return result.rows[0];
  }

  static async updateLastStart(telegramId: number): Promise<void> {
    await db.query(
      'UPDATE users SET last_start_at = NOW() WHERE telegram_id = $1',
      [telegramId]
    );
  }

  static async hasStarted(telegramId: number): Promise<boolean> {
    const user = await this.findByTelegramId(telegramId);
    return user !== null && user.last_start_at !== null;
  }
}
