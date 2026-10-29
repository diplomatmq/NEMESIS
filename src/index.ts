import { Bot } from 'grammy';
import { config } from './config';
import { db } from './database/db';
import { redis } from './database/redis';
import { handleStart } from './bot/handlers/start';
import { handleGameAction, handleStatus, handleInventory, handleUsePotion, handlePotionCallback, handleTrailCallback, handleEquipCallback, handleEquipmentMenu, handleSacrificeCallback, handleSacrificeCallbackWithPayment, handleThroneCallback, handleStatusCallback, handleMarketCallback, handleReset, handleResetCallback, handlePinTextInput } from './bot/handlers/game';
import { handleSuccessfulPayment, handlePreCheckoutQuery } from './bot/handlers/payment';
import { handleClassSelection, handleClassCallback } from './bot/handlers/class';
import { handleAchievements } from './bot/handlers/achievements';
import { handleDbStats, handleTop, handleSeasonStart } from './bot/handlers/admin';
import { handleSlotSpinCount, handleDiceMessage, handleSlotPayment } from './bot/handlers/slots';
import { InvoiceService } from './payment/InvoiceService';
import { gameService } from './game/GameService';
import { seasonService } from './game/SeasonService';

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

// Command handlers
bot.command('start', handleStart);

bot.command('status', handleStatus);
bot.command('статус', handleStatus);

bot.command('inventory', handleInventory);
bot.command('инвентарь', handleInventory);
bot.command('equipment', async (ctx) => {
  if (!ctx.from) return;
  const menu = await gameService.getEquipmentMenu(ctx.from.id);
  await ctx.reply(menu.message, { reply_markup: menu.keyboard, parse_mode: 'Markdown' });
});
bot.command('экипировка', async (ctx) => {
  if (!ctx.from) return;
  const menu = await gameService.getEquipmentMenu(ctx.from.id);
  await ctx.reply(menu.message, { reply_markup: menu.keyboard, parse_mode: 'Markdown' });
});
bot.command(['sacrifice', 'жертвоприношение'], async (ctx) => {
  if (!ctx.from) return;
  try {
    const menu = await gameService.getNecromancerMenu(ctx.from.id);
    await ctx.reply(menu.message, { reply_markup: menu.keyboard, parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(error.message || '❌ Произошла ошибка.');
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

// Admin commands
bot.command('dbstats', handleDbStats);
bot.command('top', handleTop);
bot.command('sstart', handleSeasonStart);

// Callback query handlers
bot.on('callback_query:data', async (ctx) => {
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
});

// Game action handlers
bot.hears(/^(атака|атаковать|удар|attack|a)$/i, (ctx) => handleGameAction(ctx, invoiceService));
bot.hears(/^(защита|защититься|блок|defend|block|d)$/i, (ctx) => handleGameAction(ctx, invoiceService));

// Slots system - handle text messages (spin count) in private chats
bot.on('message:text', async (ctx) => {
  if (ctx.message.text && !ctx.message.text.startsWith('/')) {
    // Pin number entry takes priority over the slots spin count.
    if (await handlePinTextInput(ctx)) return;
    if (ctx.chat.type === 'private') {
      await handleSlotSpinCount(ctx);
    }
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

    // Publish the end-of-season report once a tournament's end date passes.
    // The check is idempotent, so running it periodically is safe.
    const runSeasonCheck = () => {
      seasonService.checkAndFinalize(bot.api).catch((error) => {
        console.error('❌ Season finalization check failed:', error);
      });
    };
    runSeasonCheck();
    setInterval(runSeasonCheck, 5 * 60 * 1000);

    // Start bot
    console.log('🚀 Starting bot...');
    await bot.start();
    
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
