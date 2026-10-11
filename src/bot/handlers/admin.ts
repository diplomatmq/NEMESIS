import { Context } from 'grammy';
import { paymentService } from '../../payment/PaymentService';

const ADMIN_IDS = [793216884, 678418106];

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
      `💰 **Распределение:**\n` +
      `• Доля Soun: **${stats.sounShare}** ⭐ (75%)\n` +
      `• Доля Егор: **${stats.egorShare}** ⭐ (25%)`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
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
    message += `🌍 **Глобальный топ:**\n`;
    
    if (globalTop.length === 0) {
      message += `_Пока нет игроков_\n`;
    } else {
      globalTop.forEach(player => {
        const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '🏅';
        const name = player.username 
          ? `@${player.username}` 
          : player.first_name || `User ${player.telegram_id}`;
        message += `${medal} **#${player.rank}** ${name}\n`;
        message += `   └ ${player.class_name} • Этаж ${player.floor} • ${player.total_attack} ⚔️\n`;
      });
    }

    if (ctx.chat.type !== 'private' && chatTop.length > 0) {
      message += `\n💬 **Топ этого чата:**\n`;
      chatTop.forEach(player => {
        const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '🏅';
        const name = player.username 
          ? `@${player.username}` 
          : player.first_name || `User ${player.telegram_id}`;
        message += `${medal} **#${player.rank}** ${name}\n`;
        message += `   └ ${player.class_name} • Этаж ${player.floor} • ${player.total_attack} ⚔️\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Error getting top players:', error);
    await ctx.reply('❌ Ошибка получения топа игроков');
  }
}
