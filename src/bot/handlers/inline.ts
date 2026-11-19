import { Context, InlineKeyboard } from 'grammy';
import { InlineQueryResult } from 'grammy/types';
import { UserModel } from '../../database/models/User';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';

/**
 * Handle inline queries like @ebashnya дуэль
 * This allows users to share boss fight invitations in group chats
 */
export async function handleInlineQuery(ctx: Context) {
  if (!ctx.from || !ctx.inlineQuery) return;

  const query = ctx.inlineQuery.query.toLowerCase().trim();
  const results: InlineQueryResult[] = [];

  try {
    // Get user info
    const user = await UserModel.findByTelegramId(ctx.from.id);
    if (!user) {
      // Show message that user needs to start the bot first
      results.push({
        type: 'article',
        id: 'need_start',
        title: '❌ Начните игру',
        description: 'Сначала отправьте /start боту в личном чате',
        input_message_content: {
          message_text: '❌ Для использования игры сначала отправьте /start боту в личном чате',
        },
      });
      await ctx.answerInlineQuery(results, {
        cache_time: 0,
        is_personal: true,
      });
      return;
    }

    // Check if query is about raid/дуэль/boss
    const isRaidQuery = 
      query.includes('raid') || 
      query.includes('дуэль') || 
      query.includes('дуел') ||
      query.includes('босс') ||
      query.includes('boss') ||
      query === '';

    if (isRaidQuery) {
      // Get user's current progress to show their level
      const season = await SeasonModel.getCurrentSeason();
      let userLevel = 1;
      
      if (season) {
        const progress = await PlayerProgressModel.find(user.id, season.id);
        userLevel = progress?.level || 1;
      }
      
      const keyboard = new InlineKeyboard()
        .text('⚔️ Вызвать босса!', `chat_boss:start:${ctx.from.id}`)
        .row()
        .text('📊 Статистика', `chat_boss:stats:${ctx.from.id}`);

      results.push({
        type: 'article',
        id: 'boss_fight',
        title: '⚔️ Вызвать босса в чат',
        description: 'Сразитесь с боссом всем чатом!',
        thumbnail_url: 'https://img.icons8.com/fluency/96/sword.png',
        input_message_content: {
          message_text: 
            `⚔️ <b>ВЫЗОВ БОССА!</b>\n\n` +
            `👤 ${ctx.from.first_name || 'Игрок'} (Ур. ${userLevel}) бросает вызов!\n\n` +
            `🎯 Присоединяйтесь к битве!\n` +
            `💪 Чем больше игроков - тем выше награды!\n\n` +
            `⚡ Нажмите кнопку ниже, чтобы начать бой!`,
          parse_mode: 'HTML',
        },
        reply_markup: keyboard,
      });

      results.push({
        type: 'article',
        id: 'boss_invite',
        title: '👥 Пригласить друзей',
        description: 'Пригласите друзей в игру',
        thumbnail_url: 'https://img.icons8.com/fluency/96/add-user-group-man-man.png',
        input_message_content: {
          message_text: 
            `🎮 <b>Приглашение в NEMESIS Tower!</b>\n\n` +
            `${ctx.from.first_name || 'Игрок'} приглашает вас в эпическую RPG-игру прямо в Telegram!\n\n` +
            `⚔️ Сражайтесь с боссами\n` +
            `🏆 Прокачивайте персонажа\n` +
            `💎 Собирайте легендарные предметы\n` +
            `👥 Играйте с друзьями в групповых чатах!\n\n` +
            `🚀 Начните игру: /start`,
          parse_mode: 'HTML',
        },
      });
    }

    // If no results matched, show help
    if (results.length === 0) {
      results.push({
        type: 'article',
        id: 'help',
        title: '❓ Доступные команды',
        description: 'Попробуйте: дуэль, raid, босс',
        input_message_content: {
          message_text: 
            `📋 <b>Доступные inline команды:</b>\n\n` +
            `⚔️ <code>@${ctx.me.username} дуэль</code> - вызвать босса в чат\n` +
            `⚔️ <code>@${ctx.me.username} raid</code> - вызвать босса в чат\n` +
            `⚔️ <code>@${ctx.me.username} босс</code> - вызвать босса в чат\n` +
            `👥 <code>@${ctx.me.username}</code> - просто оставьте пустым для выбора`,
          parse_mode: 'HTML',
        },
      });
    }

    await ctx.answerInlineQuery(results, {
      cache_time: 10,
      is_personal: true,
    });

  } catch (error) {
    console.error('Error handling inline query:', error);
    
    // Show error result
    results.push({
      type: 'article',
      id: 'error',
      title: '❌ Ошибка',
      description: 'Произошла ошибка. Попробуйте позже.',
      input_message_content: {
        message_text: '❌ Произошла ошибка. Попробуйте позже.',
      },
    });

    await ctx.answerInlineQuery(results, {
      cache_time: 0,
      is_personal: true,
    });
  }
}

/**
 * Handle callback queries from inline keyboard buttons in chat boss fights
 */
export async function handleChatBossCallback(ctx: any) {
  if (!ctx.callbackQuery?.data) return;
  
  const data = ctx.callbackQuery.data;
  
  // Check if this is a chat boss callback
  if (!data.startsWith('chat_boss:')) return;

  const parts = data.split(':');
  const action = parts[1];
  const initiatorId = parseInt(parts[2], 10);

  try {
    if (action === 'start') {
      // When a player clicks "Attack Boss", redirect them to the mini app with the chat raid
      const chatId = ctx.callbackQuery?.message?.chat?.id;
      if (!chatId) {
        await ctx.answerCallbackQuery({
          text: '❌ Ошибка: не удалось определить чат',
          show_alert: true,
        });
        return;
      }

      // The mini app in app/ebashnya handles chat raids natively
      // Open the mini app with rg_<chat_id> parameter to join the raid
      const miniAppUrl = `${process.env.WEBAPP_URL || ''}?startapp=rg_${Math.abs(chatId)}`;
      
      await ctx.answerCallbackQuery({
        text: '⚔️ Открываю босса в игре...',
        url: miniAppUrl,
      });
      
    } else if (action === 'stats') {
      const user = await UserModel.findByTelegramId(initiatorId);
      if (!user) {
        await ctx.answerCallbackQuery({
          text: '❌ Пользователь не найден',
          show_alert: true,
        });
        return;
      }

      const season = await SeasonModel.getCurrentSeason();
      let statsText = '📊 Статистика недоступна';
      
      if (season) {
        const progress = await PlayerProgressModel.find(user.id, season.id);
        if (progress) {
          statsText = 
            `📊 Статистика игрока:\n` +
            `Уровень: ${progress.level}\n` +
            `HP: ${progress.hp}/${progress.max_hp}\n` +
            `⚔️ Атака: ${progress.attack}\n` +
            `🛡 Защита: ${progress.defense}`;
        }
      }
      
      await ctx.answerCallbackQuery({
        text: statsText,
        show_alert: true,
      });
    }
  } catch (error) {
    console.error('Error handling chat boss callback:', error);
    await ctx.answerCallbackQuery({
      text: '❌ Произошла ошибка',
      show_alert: true,
    });
  }
}
