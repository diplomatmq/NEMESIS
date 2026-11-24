import { db } from '../database/db';

const KEY_PREFIX = 'chat_off:';

/**
 * Per-chat switch that turns the in-chat text game off. The flag lives in app_kv,
 * is cached in memory for the process and is kept in sync by the admin command.
 */
class ChatGameService {
  private disabled = new Set<number>();

  async load(): Promise<void> {
    const result = await db.query('SELECT k FROM app_kv WHERE k LIKE $1', [`${KEY_PREFIX}%`]);
    this.disabled = new Set(
      result.rows
        .map((row: { k: string }) => Number(row.k.slice(KEY_PREFIX.length)))
        .filter((chatId: number) => Number.isInteger(chatId))
    );
  }

  isDisabled(chatId: number): boolean {
    return this.disabled.has(chatId);
  }

  async toggle(chatId: number): Promise<boolean> {
    if (this.disabled.has(chatId)) {
      await db.query('DELETE FROM app_kv WHERE k = $1', [KEY_PREFIX + chatId]);
      this.disabled.delete(chatId);
      return false;
    }

    await db.query(
      'INSERT INTO app_kv(k, v) VALUES($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v',
      [KEY_PREFIX + chatId, '1']
    );
    this.disabled.add(chatId);
    return true;
  }
}

export const chatGameService = new ChatGameService();
