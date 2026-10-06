import { Bot } from 'grammy';
import { config } from './config';
import { db } from './database/db';
import { redis } from './database/redis';
import { handleStart } from './bot/handlers/start';
import { handleGameAction, handleStatus, handleInventory } from './bot/handlers/game';
import { handleSuccessfulPayment, handlePreCheckoutQuery } from './bot/handlers/payment';
import { handleClassSelection, handleClassCallback } from './bot/handlers/class';
import { handleAchievements } from './bot/handlers/achievements';
import { InvoiceService } from './payment/InvoiceService';

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

bot.command('class', handleClassSelection);
bot.command('класс', handleClassSelection);

bot.command('achievements', handleAchievements);
bot.command('достижения', handleAchievements);

// Callback query handlers
bot.on('callback_query:data', async (ctx) => {
  await handleClassCallback(ctx);
});

// Game action handlers
bot.hears(/^(атака|атаковать|удар|attack|a)$/i, (ctx) => handleGameAction(ctx, invoiceService));
bot.hears(/^(защита|защититься|блок|defend|block|d)$/i, (ctx) => handleGameAction(ctx, invoiceService));

// Payment handlers
bot.on('message:successful_payment', handleSuccessfulPayment);
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
    console.log('✅ Database connected');

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
