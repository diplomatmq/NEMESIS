import { Api } from 'grammy';
import type { InputRichBlockTable, RichBlockTableCell } from 'grammy/types';
import { db } from '../database/db';
import { SeasonModel, SEASON_DURATION_MS } from '../database/models/Season';
import { UserModel } from '../database/models/User';
import { PlayerProgressModel, BossPin } from '../database/models/PlayerProgress';
import { classService } from './ClassService';
import { formatBossIcon } from './BossSystem';
import { CUSTOM_EMOJI, ce } from './CustomEmoji';
import { markdownToTelegramHtml } from './HealthBar';

/** The main channel that receives the per-class winrate report. */
export const SEASON_CHANNEL_ID = -1004433917168;

/** Moscow has no daylight saving time, so the offset is a constant +03:00. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Asia/Moscow wall-clock label that is written into every season message. */
function formatMsk(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()} ` +
    `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())} МСК`;
}

/** Serialises an instant as a UTC wall-clock string for a `timestamp` column. */
function toUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export interface SeasonTopPlayer {
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  floor: number;
  total_attack: number;
  class_name: string;
  active_pin?: BossPin | null;
}

export class SeasonService {
  /**
   * Starts a new tournament. The currently running season is closed first, its
   * report is published, and every player restarts from scratch while keeping
   * their skill pins and caught NFTs.
   */
  async startSeason(api: Api): Promise<string> {
    const previous = await SeasonModel.getCurrentSeason();

    // Close the running real season so its report is published before the new
    // one begins. The test season 0 is discarded silently.
    if (previous && previous.season_number >= 1) {
      await this.finalizeSeason(api, previous.id);
    }

    const newNumber = Math.max((await SeasonModel.getMaxSeasonNumber()) + 1, 1);
    const now = new Date();
    const end = new Date(now.getTime() + SEASON_DURATION_MS);

    await db.transaction(async (client) => {
      await client.query('UPDATE seasons SET is_active = false WHERE is_active = true');
      const inserted = await client.query(
        `INSERT INTO seasons (season_number, start_date, end_date, is_active, total_floors, zones_count)
         VALUES ($1, $2::timestamp, $3::timestamp, true, 500, 50)
         RETURNING id`,
        [newNumber, toUtcTimestamp(now), toUtcTimestamp(end)]
      );
      const newSeasonId: number = inserted.rows[0].id;

      if (previous) {
        // A new season means a full reset: fresh progress rows are created for
        // every player with defaults, but pins and NFTs are carried over.
        await client.query(
          `INSERT INTO player_progress (user_id, season_id, boss_pins, active_pin, nfts_caught)
           SELECT user_id, $2, boss_pins, active_pin, nfts_caught
           FROM player_progress
           WHERE season_id = $1
           ON CONFLICT (user_id, season_id) DO NOTHING`,
          [previous.id, newSeasonId]
        );
      }
    });

    const announcement =
      `🏁 **Новый сезон ${newNumber} начался!**\n\n` +
      `${ce(CUSTOM_EMOJI.season, '🏆')} Старт: ${formatMsk(now)}\n` +
      `${ce(CUSTOM_EMOJI.season, '🏆')} Финиш: ${formatMsk(end)}\n\n` +
      `Прогресс всех игроков сброшен — все начинают с первого этажа. Вперёд к вершине башни!`;

    await this.broadcast(api, markdownToTelegramHtml(announcement));

    return `✅ Сезон ${newNumber} запущен.\n\n` +
      `🏆 Старт: ${formatMsk(now)}\n` +
      `🏁 Финиш: ${formatMsk(end)}`;
  }

  /** Publishes the report for any real season whose end date has passed. */
  async checkAndFinalize(api: Api): Promise<void> {
    const season = await SeasonModel.getExpiredActiveSeason();
    if (!season) {
      return;
    }
    await this.finalizeSeason(api, season.id);
  }

  /**
   * Publishes the end-of-season report exactly once: the global top-10 is sent
   * to every group and channel, and the per-class winrate table goes to the
   * main channel as a rich message.
   */
  async finalizeSeason(api: Api, seasonId: number): Promise<void> {
    const claimed = await SeasonModel.markFinished(seasonId);
    if (!claimed) {
      return;
    }

    const info = await db.query(
      `SELECT season_number,
              to_char(end_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') AS end_msk
       FROM seasons WHERE id = $1`,
      [seasonId]
    );
    const seasonNumber = Number(info.rows[0]?.season_number ?? 0);
    const endMsk = info.rows[0]?.end_msk ? `${info.rows[0].end_msk} МСК` : '';

    const topPlayers = await this.getSeasonTopPlayers(seasonId, 10);
    const topMessage = this.buildTopMessage(seasonNumber, endMsk, topPlayers);
    await this.broadcast(api, markdownToTelegramHtml(topMessage));

    try {
      const table = await this.buildClassWinrateTable(seasonId);
      await api.sendRichMessage(SEASON_CHANNEL_ID, {
        blocks: [
          { type: 'paragraph', text: `📊 Винрейт классов — сезон ${seasonNumber}` },
          table,
        ],
      });
    } catch (error) {
      console.error('❌ Failed to send the class winrate table:', error);
    }
  }

  /** Personal summary of the most recently finished season. */
  async getSeasonStats(telegramUserId: number): Promise<string> {
    const season = await SeasonModel.getLastFinishedSeason();
    if (!season) {
      return '📊 Статистика станет доступна после завершения первого сезона.';
    }

    const user = await UserModel.findByTelegramId(telegramUserId);
    if (!user) {
      return 'Пользователь не найден. Отправьте /start в личном чате с ботом.';
    }

    const progress = await PlayerProgressModel.find(user.id, season.id);
    if (!progress) {
      return `📊 Вы не участвовали в сезоне ${season.season_number}.`;
    }

    let className = 'Не выбран';
    if (progress.class_id) {
      const gameClass = await classService.getClassById(progress.class_id);
      if (gameClass) {
        className = `${gameClass.icon} ${gameClass.name}`;
      }
    }

    const favoriteChat = await db.query(
      `SELECT ch.title
       FROM chat_progress cp
       JOIN chats ch ON ch.id = cp.chat_id
       WHERE cp.user_id = $1 AND cp.season_id = $2
       ORDER BY cp.highest_floor_reached DESC
       LIMIT 1`,
      [user.id, season.id]
    );

    return `${ce(CUSTOM_EMOJI.status, '📊')} **Статистика — Сезон ${season.season_number}**\n\n` +
      `${ce(CUSTOM_EMOJI.class, '🎭')} Класс: ${className}\n` +
      `${ce(CUSTOM_EMOJI.floor, '🏰')} Макс. этаж: ${progress.highest_floor_reached}\n` +
      `${ce(CUSTOM_EMOJI.home, '🏠')} Любимый чат: ${favoriteChat.rows[0]?.title || 'Без названия'}`;
  }

  async getSeasonTopPlayers(seasonId: number, limit: number): Promise<SeasonTopPlayer[]> {
    const result = await db.query(
      `SELECT u.telegram_id,
              u.username,
              u.first_name,
              pp.highest_floor_reached AS floor,
              pp.attack AS total_attack,
              pp.active_pin,
              COALESCE(c.name, 'Без класса') AS class_name
       FROM player_progress pp
       JOIN users u ON pp.user_id = u.id
       LEFT JOIN classes c ON pp.class_id = c.id
       WHERE pp.season_id = $1
       ORDER BY pp.highest_floor_reached DESC, pp.attack DESC
       LIMIT $2`,
      [seasonId, limit]
    );
    return result.rows;
  }

  private buildTopMessage(seasonNumber: number, endMsk: string, players: SeasonTopPlayer[]): string {
    let message = `🏁 **Турнир завершён!**\n\n` +
      `Сезон ${seasonNumber} подошёл к концу`;
    message += endMsk ? ` (${endMsk}).\n\n` : '.\n\n';
    message += `${ce(CUSTOM_EMOJI.planet, '🌍')} **Топ-10 по этажам:**\n`;

    if (players.length === 0) {
      message += `_Нет участников_\n`;
      return message;
    }

    players.forEach((player, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
      const name = player.username
        ? `<a href="https://t.me/${player.username}">${player.username}</a>`
        : player.first_name || `User ${player.telegram_id}`;
      const pin = player.active_pin ? `${formatBossIcon(player.active_pin.boss_config ?? {})} ` : '';
      message += `${medal} **#${rank}** ${pin}${name}\n`;
      message += `   └ ${ce(CUSTOM_EMOJI.class, '🎭')} ${player.class_name} • ` +
        `${ce(CUSTOM_EMOJI.floor, '🏰')} Этаж ${player.floor} • ` +
        `${ce(CUSTOM_EMOJI.attack, '⚔️')} ${player.total_attack}\n`;
    });

    return message;
  }

  /** Builds the native Telegram rich table: class vs. aggregated winrate. */
  private async buildClassWinrateTable(seasonId: number): Promise<InputRichBlockTable> {
    const result = await db.query(
      `SELECT c.name,
              c.icon,
              COALESCE(SUM(pp.total_wins), 0)::int AS wins,
              COALESCE(SUM(pp.total_deaths), 0)::int AS deaths
       FROM classes c
       LEFT JOIN player_progress pp ON pp.class_id = c.id AND pp.season_id = $1
       GROUP BY c.id, c.name, c.icon
       ORDER BY c.id`,
      [seasonId]
    );

    const cells: RichBlockTableCell[][] = [[
      { text: 'Класс', is_header: true, align: 'left', valign: 'middle' },
      { text: 'Винрейт', is_header: true, align: 'right', valign: 'middle' },
    ]];

    for (const row of result.rows) {
      const wins = Number(row.wins);
      const deaths = Number(row.deaths);
      const total = wins + deaths;
      const percent = total > 0 ? Math.round((wins / total) * 100) : 0;
      const label = row.icon ? `${row.icon} ${row.name}` : row.name;
      cells.push([
        { text: label, align: 'left', valign: 'middle' },
        { text: `${percent}%`, align: 'right', valign: 'middle' },
      ]);
    }

    return {
      type: 'table',
      cells,
      is_bordered: true,
      is_striped: true,
      is_compact: true,
    };
  }

  /** Sends a message to every non-private chat, plus the main channel. */
  private async broadcast(api: Api, html: string): Promise<void> {
    const result = await db.query(
      `SELECT telegram_chat_id FROM chats WHERE chat_type IS DISTINCT FROM 'private'`
    );
    const chatIds = new Set<number>();
    for (const row of result.rows) {
      chatIds.add(Number(row.telegram_chat_id));
    }
    chatIds.add(SEASON_CHANNEL_ID);

    for (const chatId of chatIds) {
      try {
        await api.sendMessage(chatId, html, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        console.error(`❌ Failed to broadcast the season message to chat ${chatId}:`, error);
      }
    }
  }
}

export const seasonService = new SeasonService();
