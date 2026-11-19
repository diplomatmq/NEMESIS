import { Context, InlineKeyboard } from 'grammy';
import { InlineQueryResult } from 'grammy/types';
import { UserModel } from '../../database/models/User';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';

/**
 * Handle inline queries like @ebashnya дуэль
 * Simple invite card - like in Python bot
 */
export async function handleInlineQuery(ctx: Context) {
  if (!ctx.from || !ctx.inlineQuery) return;

  try {
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    const appName = process.env.APP_NAME || 'game';
    
    // Deep link to open the game
    const gameLink = `https://t.me/${botUsername}/${appName}`;
    
    // Deep link to add bot to group and summon boss
    const addBotLink = `https://t.me/${botUsername}?startgroup=boss&admin=pin_messages`;

    const caption = 
      `🔥 <b>Зову в NEMESIS Tower!</b>\n` +
      `Пиксельная башня, где герой сам дерётся, а ты одеваешь его и лезешь всё выше.\n\n` +
      `👹 Хотите общего босса на весь чат? Добавьте бота — он покажет боссов, админ выберет, и весь чат бьёт наперегонки.`;

    const keyboard = new InlineKeyboard()
      .url('🎮 Играть', gameLink)
      .row()
      .url('👹 Добавить бота и призвать босса', addBotLink);

    const results: InlineQueryResult[] = [{
      type: 'article',
      id: 'invite',
      title: 'Позвать чат в NEMESIS',
      description: 'Приглашение в игру и босс чата',
      thumbnail_url: 'https://img.icons8.com/fluency/96/sword.png',
      input_message_content: {
        message_text: caption,
        parse_mode: 'HTML',
      },
      reply_markup: keyboard,
    }];

    await ctx.answerInlineQuery(results, {
      cache_time: 10,
      is_personal: false,
    });

  } catch (error) {
    console.error('Error handling inline query:', error);
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
    if (action === 'start' || action === 'open') {
      // When a player clicks "Attack Boss", open the mini app with the chat raid
      const chatId = ctx.callbackQuery?.message?.chat?.id;
      if (!chatId) {
        await ctx.answerCallbackQuery({
          text: '❌ Ошибка: не удалось определить чат',
          show_alert: true,
        });
        return;
      }

      // Build the start parameter: rg_<chat_id> or rg_m<abs_id> for negative IDs
      const startParam = chatId < 0 ? `rg_m${Math.abs(chatId)}` : `rg_${chatId}`;
      
      // Build deep link URL to open mini app with raid context
      const botUsername = process.env.BOT_USERNAME || 'your_bot';
      const appName = process.env.APP_NAME || 'game';
      const deepLinkUrl = `https://t.me/${botUsername}/${appName}?startapp=${startParam}`;
      
      // answerCallbackQuery with url opens the link
      await ctx.answerCallbackQuery({
        url: deepLinkUrl,
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
