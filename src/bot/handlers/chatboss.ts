import { Context, InlineKeyboard } from 'grammy';
import { ChatModel } from '../../database/models/Chat';

/**
 * Handle /boss command in group chats
 * Allows admins to summon a boss for the entire chat to fight together
 */
export async function handleBossCommand(ctx: Context) {
  if (!ctx.chat || !ctx.from) return;
  
  // Only work in group chats
  if (ctx.chat.type === 'private') {
    await ctx.reply(
      '❌ Команда /boss работает только в групповых чатах!\n\n' +
      'Добавьте бота в групповой чат и попробуйте там.'
    );
    return;
  }

  try {
    // Check if user is admin
    const member = await ctx.getChatMember(ctx.from.id);
    const isAdmin = ['creator', 'administrator'].includes(member.status);

    const miniAppUrl = process.env.WEBAPP_URL || process.env.BOT_WEBAPP_URL || '';
    
    if (!miniAppUrl) {
      await ctx.reply('❌ Мини-приложение не настроено. Обратитесь к администратору бота.');
      return;
    }

    // Build the raid URL - the mini app handles all raid logic
    // Format: rg_<chat_id> where negative chat IDs use 'm' instead of '-'
    const chatIdParam = `rg_${Math.abs(ctx.chat.id)}`;
    const raidUrl = `${miniAppUrl}?startapp=${chatIdParam}`;

    if (isAdmin) {
      // Admin can directly summon the boss
      // The mini app reads start_param/startapp to detect raid context
      // Format: rg_<chat_id> where negative IDs become rg_m123 (m instead of -)
      const chatId = ctx.chat.id;
      const startParam = chatId < 0 ? `rg_m${Math.abs(chatId)}` : `rg_${chatId}`;
      
      // Build URL with startapp parameter for deep linking
      const deepLinkUrl = `https://t.me/${process.env.BOT_USERNAME || 'your_bot'}/${process.env.APP_NAME || 'game'}?startapp=${startParam}`;
      
      const keyboard = new InlineKeyboard()
        .url('⚔️ Бить босса!', deepLinkUrl)
        .row()
        .text('📊 Статистика', `chat_boss:stats:${ctx.from.id}`);

      await ctx.reply(
        `⚔️ <b>БОСС ПРИЗВАН В ЧАТ!</b>\n\n` +
        `👤 ${ctx.from.first_name || 'Админ'} призывает босса!\n\n` +
        `🎯 Все участники чата могут присоединиться к бою!\n` +
        `💪 Чем больше игроков - тем больше наград!\n` +
        `🏆 В конце боя будет показан топ бойцов!\n\n` +
        `⚡ Нажмите кнопку ниже, чтобы начать бой!`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          reply_to_message_id: ctx.message?.message_id,
        }
      );
    } else {
      // Regular user can only request admin to summon boss
      await ctx.reply(
        `ℹ️ Призвать босса может только администратор чата.\n\n` +
        `📢 Попросите администратора написать /boss\n\n` +
        `Или используйте inline режим:\n` +
        `<code>@${ctx.me.username} дуэль</code>`,
        {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.message?.message_id,
        }
      );
    }
  } catch (error) {
    console.error('Error in /boss command:', error);
    await ctx.reply('❌ Произошла ошибка при вызове босса.');
  }
}

/**
 * Handle @botname raid / @botname босс mentions in group chats
 */
export async function handleBossMention(ctx: Context) {
  if (!ctx.chat || !ctx.from || !ctx.message?.text) return;
  
  // Only work in group chats
  if (ctx.chat.type === 'private') return;

  const text = ctx.message.text.toLowerCase();
  const botUsername = ctx.me.username.toLowerCase();
  
  // Check if message starts with @botname and contains raid/босс keywords
  if (!text.startsWith(`@${botUsername}`)) return;
  
  const words = text.split(/\s+/);
  const hasRaidKeyword = words.some(w => 
    ['raid', 'boss', 'рейд', 'босс', 'дуэль'].includes(w.toLowerCase())
  );

  if (!hasRaidKeyword) return;

  // Treat this as /boss command
  await handleBossCommand(ctx);
}

/**
 * Handle raid/boss related text commands
 */
export async function handleRaidKeywords(ctx: Context) {
  if (!ctx.message?.text || !ctx.chat || ctx.chat.type === 'private') return;
  
  const text = ctx.message.text.toLowerCase().trim();
  
  // Simple raid/boss keywords
  if (['рейд', 'raid', 'босс', 'boss'].includes(text)) {
    await ctx.reply(
      '💡 Чтобы призвать босса, используйте:\n\n' +
      '1️⃣ Команда: <code>/boss</code> (только для админов)\n' +
      `2️⃣ Inline: <code>@${ctx.me.username} дуэль</code> (для всех)\n` +
      `3️⃣ Упоминание: <code>@${ctx.me.username} raid</code>`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message?.message_id,
      }
    );
  }
}
