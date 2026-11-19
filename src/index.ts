import { Bot } from 'grammy';
import { config } from './config';
import { db } from './database/db';
import { redis } from './database/redis';
import { handleStart } from './bot/handlers/start';
import { handleGameAction, handleStatus, handleInventory, handleUsePotion, handlePotionCallback, handleTrailCallback, handleEquipCallback, handleEquipmentMenu, handleSacrificeCallback, handleSacrificeCallbackWithPayment, handleThroneCallback, handleStatusCallback, handleMarketCallback, handleReset, handleResetCallback, handlePinTextInput } from './bot/handlers/game';
import { handleSuccessfulPayment, handlePreCheckoutQuery } from './bot/handlers/payment';
import { handleClassSelection, handleClassCallback } from './bot/handlers/class';
import { handleAchievements } from './bot/handlers/achievements';
import { handleDbStats, handleTop, handleSeasonStart, handleSeasonStartCallback, handleAdminCommand, handleGiveItem, handleNftGive } from './bot/handlers/admin';
import { handleSlotSpinCount, handleDiceMessage, handleSlotPayment } from './bot/handlers/slots';
import { handleNewRef, handleRef, handleReferralCallback, handleReferralTextInput } from './bot/handlers/referral';
import { handleBan, handleUnban, handleGoblins, handleBannedUser } from './bot/handlers/bans';
import { handleInlineQuery, handleChatBossCallback } from './bot/handlers/inline';
import { handleBossCommand, handleBossMention, handleRaidKeywords } from './bot/handlers/chatboss';
import { InvoiceService } from './payment/InvoiceService';
import { gameService } from './game/GameService';
import { seasonService } from './game/SeasonService';
import { trailService } from './game/TrailService';

// Validate configuration
if (!config.bot.token) {
  console.error('❌ BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

// Create bot instance
const bot = new Bot(config.bot.token);

// Create invoice service
const invoiceService = new InvoiceService(bot);

console.log('🤖 NEMESIS Tower Game Bot starting...');

// ---------------------------------------------------------------------------
// Update relay to the Python mini-app bot.
// Only one process may call Telegram's getUpdates for a token, otherwise
// Telegram answers 409 Conflict. This TypeScript bot is that poller now; the
// Python bot runs without polling (EMBER_NO_BOT=1) but still owns a few chat
// features, so the updates it needs are relayed to it over the Docker network
// (POST /api/tg-update). Every other update is handled here as before.
// ---------------------------------------------------------------------------
const PY_FORWARD_URL = process.env.PY_FORWARD_URL || 'http://miniapp:8080/api/tg-update';

// Callback prefixes and commands the Python bot answers (this bot has no handler for them).
const PY_CALLBACK_PREFIXES = ['bs:', 'wp:', 'nf:', 'grm:'];
const PY_PRIVATE_COMMANDS = new Set([
  '/рассылка', '/broadcast', '/wipe', '/refund', '/возврат', '/terms', '/paysupport', '/support',
  '/nft', '/нфт', '/статистика', '/stats',
]);

function shouldForwardToPython(update: any): boolean {
  if (update.inline_query || update.chosen_inline_result || update.my_chat_member) {
    return true;
  }

  // Stars top-ups for the mini app: the Python bot credits the account and confirms.
  const preCheckout = update.pre_checkout_query;
  if (preCheckout && typeof preCheckout.invoice_payload === 'string' && preCheckout.invoice_payload.startsWith('st:')) {
    return true;
  }

  const callbackQuery = update.callback_query;
  if (callbackQuery) {
    const data: string = callbackQuery.data || '';
    if (PY_CALLBACK_PREFIXES.some((prefix) => data.startsWith(prefix))) return true;
    if (data === 'stats_all' || data.startsWith('bc:')) return true;
  }

  const message = update.message;
  if (message) {
    if (message.successful_payment?.invoice_payload?.startsWith('st:')) return true;

    const chatType = message.chat?.type;
    const username = (config.bot.username || '').toLowerCase();
    const text: string = message.text || message.caption || '';

    if (chatType === 'group' || chatType === 'supergroup') {
      // The Python bot greets a group when it is added there.
      if ((message.new_chat_members || []).some(
        (member: any) => (member.username || '').toLowerCase() === username
      )) {
        return true;
      }
      if (!text) return false;

      // Group boss panel and group /start are drawn by the Python bot.
      const first = text.split(/\s+/)[0] || '';
      const command = first.split('@')[0].toLowerCase();
      if (command === '/boss' || command === '/start') return true;
      const words = text.toLowerCase().split(/\s+/);
      if (username && words[0] === '@' + username && ['raid', 'boss', 'рейд', 'босс'].includes(words[1])) {
        return true;
      }
      return false;
    }

    if (chatType === 'private' && text) {
      const command = (text.split(/\s+/)[0] || '').split('@')[0].toLowerCase();
      return PY_PRIVATE_COMMANDS.has(command);
    }
  }

  return false;
}

async function forwardUpdateToPython(update: unknown): Promise<void> {
  try {
    const response = await fetch(PY_FORWARD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TG-Forward': config.bot.token,
      },
      body: JSON.stringify(update),
    });
    if (!response.ok) {
      console.error(`⚠️ Forward to Python returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('⚠️ Failed to forward update to the Python bot:', error);
  }
}

// Registered first: once an update is relayed to Python, this bot must not also
// process it (that would double-answer callbacks, payments and boss panels).
bot.use(async (ctx, next) => {
  if (shouldForwardToPython(ctx.update)) {
    void forwardUpdateToPython(ctx.update);
    return;
  }
  return next();
});

// ---------------------------------------------------------------------------
// Anti-automation: scheduled ("отложенные") Telegram messages must never drive
// gameplay. Telegram flags such updates with `is_from_offline`, so the check
// only reads that flag instead of guessing from timings or message delays.
// It is registered first, before every command and action handler, so an
// alternative handler cannot be used to bypass it.
// ---------------------------------------------------------------------------
const OFFLINE_BLOCKED_COMMANDS = new Set<string>([
  'potion', 'зелье',
  'class', 'класс',
  'sacrifice', 'жертвоприношение',
  'reset', 'сброс',
]);

const OFFLINE_COMBAT_TEXT =
  /^(атака|атаковать|удар|attack|a|защита|защититься|блок|defend|block|d)$/i;

bot.use(async (ctx, next) => {
  const message = ctx.msg;

  // Only offline messages are restricted; callbacks can never be scheduled.
  if (!message || message.is_from_offline !== true) {
    return next();
  }

  const raw = (message.text ?? message.caption ?? '').trim();
  const command = raw.startsWith('/')
    ? raw.slice(1).split(/[\s@]/)[0].toLowerCase()
    : null;

  // Numbers cover the pin picker and the slot spin counter, both of which
  // change the player's state.
  const isGameplayAction = command !== null
    ? OFFLINE_BLOCKED_COMMANDS.has(command)
    : OFFLINE_COMBAT_TEXT.test(raw) || /^\d+$/.test(raw) || message.dice !== undefined;

  if (!isGameplayAction) {
    return next();
  }

  console.warn(
    `🚫 Offline message blocked for user ${ctx.from?.id ?? 'unknown'} in chat ${ctx.chat?.id ?? 'unknown'}`
  );

  await ctx.reply(
    '🚫 Отложенные сообщения нельзя использовать для игровых действий!\n\n' +
    '⚔️ Атаковать и защищаться необходимо вручную. ' +
    'Просмотр персонажа и инвентаря остаётся доступен'
  );
});

// ---------------------------------------------------------------------------
// Blocked players: the check sits before every command and action handler, so
// a blocked player can neither play nor open the game menus. The public
// /goblins list stays reachable for everyone.
// ---------------------------------------------------------------------------
bot.use(handleBannedUser);

// Command handlers
bot.command('start', handleStart);

bot.command('status', handleStatus);
bot.command('статус', handleStatus);

bot.command('inventory', handleInventory);
bot.command('инвентарь', handleInventory);
bot.command('equipment', async (ctx) => {
  if (!ctx.from) return;
  const menu = await gameService.getEquipmentMenu(ctx.from.id);
  await ctx.reply(menu.message, { 
    reply_markup: menu.keyboard, 
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message?.message_id
  });
});
bot.command('экипировка', async (ctx) => {
  if (!ctx.from) return;
  const menu = await gameService.getEquipmentMenu(ctx.from.id);
  await ctx.reply(menu.message, { 
    reply_markup: menu.keyboard, 
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message?.message_id
  });
});
bot.command(['sacrifice', 'жертвоприношение'], async (ctx) => {
  if (!ctx.from) return;
  try {
    const menu = await gameService.getNecromancerMenu(ctx.from.id);
    await ctx.reply(menu.message, { 
      reply_markup: menu.keyboard, 
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message?.message_id
    });
  } catch (error: any) {
    await ctx.reply(error.message || '❌ Произошла ошибка.', {
      reply_to_message_id: ctx.message?.message_id
    });
  }
});

bot.command('potion', handleUsePotion);
bot.command('зелье', handleUsePotion);

bot.command('class', handleClassSelection);
bot.command('класс', handleClassSelection);

bot.command('achievements', handleAchievements);
bot.command('достижения', handleAchievements);

bot.command('reset', handleReset);
bot.command('сброс', handleReset);

bot.command('goblins', handleGoblins);
bot.command('гоблины', handleGoblins);

// Admin commands
bot.command('dbstats', handleDbStats);
bot.command('top', handleTop);
bot.command('sstart', handleSeasonStart);
bot.command('admin', handleAdminCommand);
bot.command('giveitem', handleGiveItem);
bot.command('nftgive', handleNftGive);
bot.command('ban', handleBan);
bot.command('unban', handleUnban);

// Referral system
bot.command('new_ref', handleNewRef);
bot.command('ref', handleRef);

// Chat boss commands - DO NOT HANDLE, let Python bot handle them
// Python bot (app/ebashnya/app/server.py) processes /boss and inline_query

// Callback query handlers
bot.on('callback_query:data', async (ctx) => {
  await handleChatBossCallback(ctx);
  await handleSeasonStartCallback(ctx);
  await handleClassCallback(ctx);
  await handleTrailCallback(ctx);
  await handleEquipCallback(ctx);
  await handleEquipmentMenu(ctx);
  await handleSacrificeCallbackWithPayment(ctx, invoiceService);
  await handleSacrificeCallback(ctx);
  await handleThroneCallback(ctx);
  await handlePotionCallback(ctx);
  await handleStatusCallback(ctx);
  await handleResetCallback(ctx);
  await handleMarketCallback(ctx);
  await handleReferralCallback(ctx);
});

// Game action handlers
bot.hears(/^(атака|атаковать|удар|attack|a)$/i, (ctx) => handleGameAction(ctx, invoiceService));
bot.hears(/^(защита|защититься|блок|defend|block|d)$/i, (ctx) => handleGameAction(ctx, invoiceService));

// Chat boss mentions: @botname raid, @botname босс
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (!text) return;
  
  // Check for bot mentions with raid/boss keywords
  if (text.startsWith('@')) {
    await handleBossMention(ctx);
    return;
  }
  
  // Check for standalone raid keywords
  await handleRaidKeywords(ctx);
  
  // Pin number entry takes priority over the slots spin count.
  if (await handlePinTextInput(ctx)) return;
  // Referral wizard answers (admins configuring /new_ref).
  if (await handleReferralTextInput(ctx)) return;
  if (ctx.chat.type === 'private') {
    await handleSlotSpinCount(ctx);
  }
});

// Slots system - handle dice messages in private chats
bot.on('message:dice', async (ctx) => {
  if (ctx.chat.type === 'private') {
    await handleDiceMessage(ctx);
  }
});

// Payment handlers
bot.on('message:successful_payment', async (ctx) => {
  if (!ctx.message?.successful_payment) return;
  
  const payload = ctx.message.successful_payment.invoice_payload;
  
  // Check if it's a slot payment
  if (payload.startsWith('slot:')) {
    await handleSlotPayment(ctx, payload);
  } else {
    await handleSuccessfulPayment(ctx, invoiceService);
  }
});
bot.on('pre_checkout_query', handlePreCheckoutQuery);

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Startup sequence
async function start() {
  try {
    // Connect to Redis
    console.log('🔌 Connecting to Redis...');
    await redis.connect();
    console.log('✅ Redis connected');

    // Test database connection
    console.log('🔌 Testing database connection...');
    await db.query('SELECT NOW()');
    const schemaCheck = await db.query(`
      SELECT
        current_database() AS database_name,
        current_schema() AS schema_name,
        to_regclass('public.users') AS users_table,
        to_regclass('public.chats') AS chats_table
    `);
    const schema = schemaCheck.rows[0];
    if (!schema.users_table || !schema.chats_table) {
      throw new Error(
        `Database schema is incomplete in ${schema.database_name}.${schema.schema_name}: ` +
        'public.users and public.chats are required'
      );
    }
    console.log('✅ Database connected');

    // Unblock players whose pending path choice was left without usable buttons:
    // resolve leftover trail events with a random direction.
    try {
      const resolvedTrails = await trailService.resolvePendingEvents();
      if (resolvedTrails > 0) {
        console.log(`🧭 Auto-resolved ${resolvedTrails} pending trail event(s)`);
      }
    } catch (error) {
      console.error('⚠️ Trail cleanup failed:', error);
    }

    // Credit boss souls a necromancer earned before soul tracking existed.
    try {
      const repairedSouls = await gameService.backfillNecromancerBossSouls();
      if (repairedSouls > 0) {
        console.log(`☠️ Backfilled boss souls for ${repairedSouls} necromancer(s)`);
      }
    } catch (error) {
      console.error('⚠️ Necromancer soul backfill failed:', error);
    }

    // Publish the end-of-season report once a tournament's end date passes.
    // The check is idempotent, so running it periodically is safe.
    const runSeasonCheck = () => {
      seasonService.checkAndFinalize(bot.api).catch((error) => {
        console.error('❌ Season finalization check failed:', error);
      });
    };
    runSeasonCheck();
    setInterval(runSeasonCheck, 5 * 60 * 1000);

    // Start bot as the only getUpdates poller. inline_query / chosen_inline_result
    // are received here and relayed to the Python bot (see the relay above).
    console.log('🚀 Starting bot...');
    await bot.start({
      allowed_updates: [
        'message',
        'callback_query',
        'my_chat_member',
        'pre_checkout_query',
        'inline_query',
        'chosen_inline_result',
      ],
    });
    
    console.log('✅ Bot is running!');
    console.log(`👤 Bot username: @${config.bot.username || 'unknown'}`);
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down...');
  
  try {
    await bot.stop();
    await redis.close();
    await db.close();
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the bot
start();
