import { db } from '../db';

export interface Chat {
  id: number;
  telegram_chat_id: number;
  chat_type?: string;
  title?: string;
  created_at: Date;
}

export class ChatModel {
  static async findByTelegramChatId(telegramChatId: number): Promise<Chat | null> {
    const result = await db.query(
      'SELECT * FROM chats WHERE telegram_chat_id = $1',
      [telegramChatId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    telegram_chat_id: number;
    chat_type?: string;
    title?: string;
  }): Promise<Chat> {
    const result = await db.query(
      `INSERT INTO chats (telegram_chat_id, chat_type, title)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_chat_id) DO UPDATE SET
         chat_type = EXCLUDED.chat_type,
         title = EXCLUDED.title
       RETURNING *`,
      [data.telegram_chat_id, data.chat_type, data.title]
    );
    return result.rows[0];
  }

  static async findOrCreate(data: {
    telegram_chat_id: number;
    chat_type?: string;
    title?: string;
  }): Promise<Chat> {
    let chat = await this.findByTelegramChatId(data.telegram_chat_id);
    if (!chat) {
      chat = await this.create(data);
    }
    return chat;
  }
}
