import { Context, Api } from 'grammy';
import { paymentService } from '../../payment/PaymentService';
import { markdownToTelegramHtml } from '../../game/HealthBar';
import { CUSTOM_EMOJI, ce } from '../../game/CustomEmoji';
import { formatBossIcon } from '../../game/BossSystem';
import { seasonService } from '../../game/SeasonService';
import { slotMachineService } from '../../game/SlotMachineService';
import { referralService } from '../../game/ReferralService';
import { UserModel } from '../../database/models/User';

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

    // Referral chats claim their share first (their full unpaid balance, even
    // when it is still below the payout minimum); Soun and Egor split the rest.
    const referrals = await referralService.getAllStatuses();
    const referralObligations = referrals.reduce((sum, referral) => sum + referral.balance, 0);
    const remainder = Math.max(0, stats.totalStars - referralObligations);
    const sounShare = Math.floor(remainder * 0.75);
    const egorShare = Math.floor(remainder * 0.25);

    let message =
      `📊 **Статистика базы данных**\n\n` +
      `👥 **Игроков:** ${stats.totalPlayers}\n` +
      `💬 **Чатов:** ${stats.totalChats} (без личных)\n` +
      `⭐ **Всего звёзд:** ${stats.totalStars}\n\n` +
      `${ce(CUSTOM_EMOJI.gold, '💰')} **Распределение:**\n` +
      `• Доля Soun: **${sounShare}** ⭐ (75%)\n` +
      `• Доля Егор: **${egorShare}** ⭐ (25%)`;

    if (referrals.length > 0) {
      message += `\n\n📈 **Реферальные чаты** (к выводу: ${referralObligations} ⭐):\n`;
      for (const referral of referrals) {
        message += `• Чат ${referral.chat_telegram_id} — ${referral.percent}% — ${referral.balance} ⭐\n`;
      }
    }

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

    await ctx.reply(markdownToTelegramHtml(message), { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ Error getting top players:', error);
    await ctx.reply('❌ Ошибка получения топа игроков');
  }
}

/**
 * /sstart — starts a new tournament. Only administrators may call it, and only
 * from a private chat with the bot.
 */
export async function handleSeasonStart(ctx: Context) {
  if (!ctx.from) {
    return;
  }

  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  if (ctx.chat?.type !== 'private') {
    await ctx.reply('⚠️ Команда /sstart работает только в личных сообщениях с ботом.');
    return;
  }

  try {
    const result = await seasonService.startSeason(ctx.api);
    await ctx.reply(result);
  } catch (error: any) {
    console.error('❌ Error starting season:', error);
    await ctx.reply(`❌ Ошибка запуска сезона: ${error.message || 'Неизвестная ошибка'}`);
  }
}

/**
 * /giveitem <telegram_id|@username> [count] — grants random items to a player,
 * used to compensate for a drop that failed after the spin was consumed.
 * Administrators only.
 */
export async function handleGiveItem(ctx: Context) {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  const args = (ctx.message?.text ?? '').split(/\s+/).slice(1);
  if (args.length === 0) {
    await ctx.reply('Использование: /giveitem <telegram_id|@username> [кол-во]');
    return;
  }

  const count = Math.min(Math.max(parseInt(args[1] ?? '1', 10) || 1, 1), 10);
  const target = args[0].startsWith('@')
    ? await UserModel.findByUsername(args[0].slice(1))
    : await UserModel.findByTelegramId(Number(args[0]));

  if (!target) {
    await ctx.reply('❌ Игрок не найден в базе данных.');
    return;
  }

  try {
    const items = await slotMachineService.grantRandomItems(Number(target.telegram_id), count);

    try {
      const list = items.map((item) => `• ${item.name} (${item.rarity})`).join('\n');
      await ctx.api.sendMessage(
        Number(target.telegram_id),
        `🎁 Компенсация\n\nВам выдан предмет за сбой в Лотах:\n${list}\n\nПроверьте инвентарь: /status`,
        { link_preview_options: { is_disabled: true } }
      );
    } catch (error) {
      console.error('⚠️ Failed to notify compensated player:', error);
    }

    const summary = items.map((item) => `${item.name} (${item.rarity})`).join(', ');
    await ctx.reply(`✅ Выдано предметов: ${items.length}\n${summary}`);
  } catch (error: any) {
    console.error('❌ Error granting items:', error);
    await ctx.reply(`❌ Ошибка выдачи: ${error.message || 'Неизвестная ошибка'}`);
  }
}
