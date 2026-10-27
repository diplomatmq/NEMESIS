import { Context, Api } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { CUSTOM_EMOJI, ce } from '../../game/CustomEmoji';
import { formatBossIcon } from '../../game/BossSystem';

export const ADMIN_IDS = [793216884, 678418106];

/** Send a direct message to every administrator, ignoring individual failures. */
export async function notifyAdmins(api: Api, text: string): Promise<void> {
  for (const adminId of ADMIN_IDS) {
    try {
      await api.sendMessage(adminId, text, { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`❌ Failed to notify admin ${adminId}:`, error);
    }
  }
}

export async function handleDbStats(ctx: Context) {
  if (!ctx.from) {
    return;
  }

  // Check if user is admin
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return; // Silently ignore for non-admins
  }

  try {
    const stats = await paymentService.getDatabaseStats();

    const message = 
      `📊 **Статистика базы данных**\n\n` +
      `👥 **Игроков:** ${stats.totalPlayers}\n` +
      `💬 **Чатов:** ${stats.totalChats} (без личных)\n` +
      `⭐ **Всего звёзд:** ${stats.totalStars}\n\n` +
      `${ce(CUSTOM_EMOJI.gold, '💰')} **Распределение:**\n` +
      `• Доля Soun: **${stats.sounShare}** ⭐ (75%)\n` +
      `• Доля Егор: **${stats.egorShare}** ⭐ (25%)`;

    await ctx.reply(markdownToTelegramHtml(message), { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ Error getting DB stats:', error);
    await ctx.reply('❌ Ошибка получения статистики');
  }
}

export async function handleTop(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  try {
    // Get global top 5
    const globalTop = await paymentService.getGlobalTopPlayers(5);
    
    // Get chat top 5 (only if not a private chat)
    let chatTop: any[] = [];
    if (ctx.chat.type !== 'private') {
      chatTop = await paymentService.getChatTopPlayers(ctx.chat.id, 5);
    }

    let message = `🏆 **ТОП-5 ИГРОКОВ**\n\n`;
    message += `${ce(CUSTOM_EMOJI.planet, '🌍')} **Глобальный топ:**\n`;
    
    if (globalTop.length === 0) {
      message += `*Пока нет игроков*\n`;
    } else {
      globalTop.forEach(player => {
        const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '🏅';
        const name = player.username
          ? `<a href="https://t.me/${player.username}">${player.username}</a>`
          : player.first_name || `User ${player.telegram_id}`;
        const pin = player.active_pin ? `${formatBossIcon(player.active_pin.boss_config ?? {})} ` : '';
        message += `${medal} **#${player.rank}** ${pin}${name}\n`;
        message += `   └ ${ce(CUSTOM_EMOJI.class, '🎭')} ${player.class_name} • ${ce(CUSTOM_EMOJI.floor, '🏰')} Этаж ${player.floor} • ${ce(CUSTOM_EMOJI.attack, '⚔️')} ${player.total_attack}\n`;
      });
    }

    if (ctx.chat.type !== 'private' && chatTop.length > 0) {
      message += `\n💬 **Топ этого чата:**\n`;
      chatTop.forEach(player => {
        const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '🏅';
        const name = player.username
          ? `<a href="https://t.me/${player.username}">${player.username}</a>`
          : player.first_name || `User ${player.telegram_id}`;
        const pin = player.active_pin ? `${formatBossIcon(player.active_pin.boss_config ?? {})} ` : '';
        message += `${medal} **#${player.rank}** ${pin}${name}\n`;
        message += `   └ ${ce(CUSTOM_EMOJI.class, '🎭')} ${player.class_name} • ${ce(CUSTOM_EMOJI.floor, '🏰')} Этаж ${player.floor} • ${ce(CUSTOM_EMOJI.attack, '⚔️')} ${player.total_attack}\n`;
      });
    }

    await ctx.reply(markdownToTelegramHtml(message), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('❌ Error getting top players:', error);
    await ctx.reply('❌ Ошибка получения топа игроков');
  }
}
