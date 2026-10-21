import { Context } from 'grammy';
import { gameService } from '../../game/GameService';
import { trailService } from '../../game/TrailService';
import { UserModel } from '../../database/models/User';
import { ChatModel } from '../../database/models/Chat';
import { SeasonModel } from '../../database/models/Season';
import { PlayerProgressModel } from '../../database/models/PlayerProgress';
import { InvoiceService } from '../../payment/InvoiceService';
import { markdownToTelegramHtml } from '../../game/HealthBar';

export async function handleGameAction(ctx: Context, invoiceService: InvoiceService) {
  if (!ctx.from || !ctx.chat || !ctx.message?.text) {
    return;
  }

  const action = ctx.message.text.trim();

  try {
    // Execute action
    const result = await gameService.executeAction(
      {
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        chatType: ctx.chat.type,
        chatTitle: 'title' in ctx.chat ? ctx.chat.title : undefined,
      },
      action,
      false // not bypassing cooldown
    );

    // If cooldown is active and payment needed
    if (result.needsPayment && result.cooldownInfo) {
      // Create invoice
      const { keyboard } = await invoiceService.createSkipCooldownInvoice(
        ctx.from.id,
        ctx.chat.id,
        action
      );

      await ctx.reply(markdownToTelegramHtml(result.message), {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: ctx.message.message_id,
        },
      });
      return;
    }

    // Send result message
    await ctx.reply(markdownToTelegramHtml(result.message), {
      reply_markup: result.keyboard,
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.message.message_id,
      },
    });
    if (result.privateMessage) {
      await ctx.api.sendMessage(ctx.from.id, result.privateMessage);
    }
  } catch (error: any) {
    console.error('Error in handleGameAction:', error);
    await ctx.reply(`❌ Ошибка: ${error.message || 'Неизвестная ошибка'}`).catch(() => {});
  }
}

export async function handleTrailCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  // Trail choice callback
  const trailMatch = /^trail:(\d+):(\d+)$/.exec(data);
  
  // Market callbacks - updated patterns
  const marketModeMatch = /^trailmarket:(\d+):mode:(buy|sell|exchange|main)$/.exec(data);
  const marketBuyMatch = /^trailmarket:(\d+):buy:(\d+)$/.exec(data);
  const marketSellMatch = /^trailmarket:(\d+):sell:(\d+)$/.exec(data);
  const marketSellPageMatch = /^trailmarket:(\d+):sellpage:(\d+)$/.exec(data);
  const marketExch1Match = /^trailmarket:(\d+):exch1:(\d+)$/.exec(data);
  const marketExch2Match = /^trailmarket:(\d+):exch2:(\d+):(\d+)$/.exec(data);
  const marketExchPageMatch = /^trailmarket:(\d+):exchpage:(\d+):(\d+)$/.exec(data);
  
  // Old market action match for backwards compatibility
  const marketActionMatch = /^marketaction:(\d+):(buy|sell|exchange)$/.exec(data);
  
  if (!trailMatch && !marketModeMatch && !marketBuyMatch && !marketSellMatch && 
      !marketSellPageMatch && !marketExch1Match && !marketExch2Match && 
      !marketExchPageMatch && !marketActionMatch) return;

  try {
    let result;
    
    if (trailMatch) {
      // Trail choice
      result = await gameService.resolveTrail(
        ctx.from.id,
        ctx.chat.id,
        Number(trailMatch[1]),
        Number(trailMatch[2])
      );
    } else if (marketModeMatch) {
      // Mode selection or back to main
      const [, marketId, mode] = marketModeMatch;
      
      if (mode === 'main') {
        // Show main market menu again
        const user = await UserModel.findByTelegramId(ctx.from.id);
        const season = await SeasonModel.getCurrentSeason();
        const progress = await PlayerProgressModel.find(user!.id, season!.id);
        const chat = await ChatModel.findByTelegramChatId(ctx.chat.id);
        
        result = await trailService.resolveMarketAction(
          user!.id,
          progress!.id,
          chat!.id,
          Number(marketId),
          'buy' as any, // Will show main menu
          undefined
        );
      } else {
        result = await gameService.resolveTrailMarketAction(
          ctx.from.id,
          ctx.chat.id,
          Number(marketId),
          mode as any
        );
      }
    } else if (marketBuyMatch) {
      // Execute buy
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketBuyMatch[1]),
        'buy',
        Number(marketBuyMatch[2])
      );
    } else if (marketSellMatch) {
      // Execute sell
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketSellMatch[1]),
        'sell',
        Number(marketSellMatch[2])
      );
    } else if (marketSellPageMatch) {
      // Sell pagination
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      const chat = await ChatModel.findByTelegramChatId(ctx.chat.id);
      
      result = await trailService.showSellMode(
        progress!.id,
        Number(marketSellPageMatch[1]),
        Number(marketSellPageMatch[2])
      );
    } else if (marketExch1Match) {
      // Exchange step 1 - selected market item, show player inventory
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      
      result = await trailService.showExchangeSelectPlayerItem(
        progress!.id,
        Number(marketExch1Match[1]),
        Number(marketExch1Match[2]),
        0
      );
    } else if (marketExch2Match) {
      // Execute exchange
      const marketItemIdx = Number(marketExch2Match[2]);
      const playerItemIdx = Number(marketExch2Match[3]);
      
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketExch2Match[1]),
        'exchange',
        `${marketItemIdx}_${playerItemIdx}` as any
      );
    } else if (marketExchPageMatch) {
      // Exchange pagination
      const user = await UserModel.findByTelegramId(ctx.from.id);
      const season = await SeasonModel.getCurrentSeason();
      const progress = await PlayerProgressModel.find(user!.id, season!.id);
      
      result = await trailService.showExchangeSelectPlayerItem(
        progress!.id,
        Number(marketExchPageMatch[1]),
        Number(marketExchPageMatch[2]),
        Number(marketExchPageMatch[3])
      );
    } else if (marketActionMatch) {
      // Old action format
      result = await gameService.resolveTrailMarketAction(
        ctx.from.id,
        ctx.chat.id,
        Number(marketActionMatch[1]),
        marketActionMatch[2] as any
      );
    }

    if (result) {
      await ctx.answerCallbackQuery(result.message.slice(0, 190));
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(markdownToTelegramHtml(result.message), {
          parse_mode: 'HTML',
          reply_markup: result.keyboard,
        });
      }
    }
  } catch (error: any) {
    console.error('Error in handleTrailCallback:', error);
    await ctx.answerCallbackQuery(error.message || '❌ Ошибка');
  }
}

export async function handleStatus(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const isPrivateChat = ctx.chat.type === 'private';
  const result = await gameService.getPlayerStatus(ctx.from.id, ctx.chat.id, isPrivateChat);
  await ctx.reply(markdownToTelegramHtml(result.message), { 
    parse_mode: 'HTML',
    reply_markup: result.keyboard
  });
}

export async function handleInventory(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const inventory = await gameService.getInventory(ctx.from.id, ctx.chat.id);
  await ctx.reply(inventory, { parse_mode: 'Markdown' });
}

export async function handleEquipCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const match = /^equip:(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const message = await gameService.equipItem(ctx.from.id, Number(match[1]));
  await ctx.answerCallbackQuery(message.slice(0, 190));
}

export async function handleEquipmentMenu(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const menu = /^equipmenu:(\w+):(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
  const item = /^equipitem:(\d+):(\w+):(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
  if (!menu && !item) return;
  
  // Check if user is authorized
  if (menu && Number(menu[3]) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  if (item && Number(item[4]) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  
  if (menu) {
    try {
      const result = await gameService.getEquipmentMenu(ctx.from.id, menu[1], Number(menu[2]));
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        // Check if message content changed before editing
        const currentText = ctx.callbackQuery.message.text || '';
        if (currentText !== result.message) {
          await ctx.editMessageText(result.message, {
            reply_markup: result.keyboard,
            parse_mode: 'Markdown',
          });
        }
      }
    } catch (error: any) {
      await ctx.answerCallbackQuery(error.message || '❌ Ошибка');
    }
    return;
  }
  
  try {
    const result = await gameService.toggleEquipment(
      ctx.from.id,
      Number(item![1]),
      item![2]
    );
    await ctx.answerCallbackQuery(result.slice(0, 190));
    if (ctx.callbackQuery.message) {
      const refreshed = await gameService.getEquipmentMenu(ctx.from.id, item![2], Number(item![3]));
      await ctx.editMessageText(refreshed.message, {
        reply_markup: refreshed.keyboard,
        parse_mode: 'Markdown',
      });
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(error.message || '❌ Ошибка');
  }
}

export async function handleSacrificeCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('sacrifice:') || data.startsWith('sacrifice:skip:')) return;
  
  if (data === 'sacrifice:close') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Меню жертвоприношения закрыто.');
    return;
  }
  
  // Handle soul replacement
  const replaceMatch = /^sacrifice:replace:(\d+)$/.exec(data);
  if (replaceMatch) {
    const message = await gameService.replaceBossSoul(ctx.from.id, Number(replaceMatch[1]));
    await ctx.answerCallbackQuery(message.slice(0, 190));
    await ctx.editMessageText(message);
    return;
  }
  
  // Handle decline
  if (data === 'sacrifice:decline') {
    await gameService.declineBossSoul(ctx.from.id);
    await ctx.answerCallbackQuery('Душа отвергнута');
    await ctx.editMessageText('❌ Вы отказались от поглощения души.');
    return;
  }

  const [, target, index] = data.split(':');
  const message = await gameService.sacrifice(ctx.from.id, target as 'mobs' | 'boss', index ? Number(index) : undefined);
  await ctx.answerCallbackQuery(message.slice(0, 190));
  await ctx.editMessageText(message);
}

export async function handleSacrificeCallbackWithPayment(
  ctx: Context,
  invoiceService: InvoiceService
) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const match = /^sacrifice:skip:(mobs|boss)(?::(\d+))?$/.exec(ctx.callbackQuery.data);
  if (!match) return;
  const command = `sacrifice_skip:${match[1]}${match[2] ? `:${match[2]}` : ''}`;
  const { keyboard } = await invoiceService.createSkipCooldownInvoice(
    ctx.from.id,
    ctx.chat.id,
    command,
    5,
    'Пропуск КД жертвоприношения'
  );
  await ctx.answerCallbackQuery();
  await ctx.reply('⏳ Ритуал ещё на cooldown. Пропустить его можно за 5 Telegram Stars.', {
    reply_markup: keyboard,
  });
}

export async function handleThroneCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('throne:')) return;
  if (data === 'throne:skip') {
    await ctx.answerCallbackQuery('Души сохранены.');
    await ctx.editMessageText('👑 Трон из мёртвых отвергнут. Души сохранены.');
    return;
  }
  const match = /^throne:sacrifice:(\d+)$/.exec(data);
  if (!match) return;
  const result = await gameService.sacrifice(ctx.from.id, 'boss', Number(match[1]));
  await ctx.answerCallbackQuery(result.slice(0, 190));
  await ctx.editMessageText(result);
}

export async function handleUsePotion(ctx: Context) {
  if (!ctx.from || !ctx.chat) {
    return;
  }

  const menu = await gameService.getPotionMenu(ctx.from.id, ctx.chat.id);
  await ctx.reply(markdownToTelegramHtml(menu.message), {
    parse_mode: 'HTML',
    reply_markup: menu.keyboard,
  });
}

export async function handlePotionCallback(ctx: Context) {
  if (!ctx.from || !ctx.chat || !ctx.callbackQuery?.data) return;
  const match = /^potion:use:(\d+)$/.exec(ctx.callbackQuery.data);
  if (!match) return;

  const result = await gameService.usePotion(ctx.from.id, ctx.chat.id, Number(match[1]));
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(markdownToTelegramHtml(result.message), { parse_mode: 'HTML' });
}

/**
 * Handle status menu callbacks (market, inventory, equipment, slots)
 */
export async function handleStatusCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  // Parse status menu callbacks
  const statusMatch = /^status:(market|inventory|equipment|slots):(\d+)$/.exec(data);
  if (!statusMatch) return;
  
  const [, action, userId] = statusMatch;
  
  // Check authorization
  if (Number(userId) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  
  try {
    if (action === 'market') {
      const result = await gameService.getDailyMarket(ctx.from.id, 0);
      await ctx.answerCallbackQuery();
      await ctx.reply(result.message, {
        reply_markup: result.keyboard,
        parse_mode: 'Markdown',
      });
    } else if (action === 'inventory') {
      const inventory = await gameService.getInventory(ctx.from.id, ctx.chat!.id);
      await ctx.answerCallbackQuery();
      await ctx.reply(inventory, { parse_mode: 'Markdown' });
    } else if (action === 'equipment') {
      const result = await gameService.getEquipmentMenu(ctx.from.id);
      await ctx.answerCallbackQuery();
      await ctx.reply(result.message, {
        reply_markup: result.keyboard,
        parse_mode: 'Markdown',
      });
    } else if (action === 'slots') {
      // Import slots handler dynamically to avoid circular dependencies
      try {
        const { handleSlotsButton } = await import('./slots');
        await ctx.answerCallbackQuery();
        console.log(`[SLOTS] Button clicked by user ${ctx.from.id}`);
        await handleSlotsButton(ctx);
      } catch (error: any) {
        console.error('[SLOTS] Error handling slots button:', error);
        await ctx.answerCallbackQuery(`❌ Ошибка: ${error.message}`);
      }
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(error.message || '❌ Ошибка');
  }
}

/**
 * Handle daily market callbacks (pagination, buy, close)
 */
export async function handleMarketCallback(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery?.data) return;
  const data = ctx.callbackQuery.data;
  
  if (!data.startsWith('market:')) return;
  
  // Parse market callbacks
  const pageMatch = /^market:page:(\d+):(\d+)$/.exec(data);
  const buyMatch = /^market:buy:(\d+):(\d+)$/.exec(data);
  const closeMatch = /^market:close:(\d+)$/.exec(data);
  
  if (!pageMatch && !buyMatch && !closeMatch) return;
  
  // Check authorization
  const userId = pageMatch?.[2] || buyMatch?.[2] || closeMatch?.[1];
  if (Number(userId) !== ctx.from.id) {
    await ctx.answerCallbackQuery('❌ Это не ваше меню!');
    return;
  }
  
  try {
    if (pageMatch) {
      // Pagination
      const page = Number(pageMatch[1]);
      const result = await gameService.getDailyMarket(ctx.from.id, page);
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(result.message, {
          reply_markup: result.keyboard,
          parse_mode: 'Markdown',
        });
      }
    } else if (buyMatch) {
      // Buy item
      const itemIndex = Number(buyMatch[1]);
      const result = await gameService.buyFromDailyMarket(ctx.from.id, itemIndex);
      
      if (result.success) {
        await ctx.answerCallbackQuery(result.message.slice(0, 190));
        // Refresh market to show updated gold
        const market = await gameService.getDailyMarket(ctx.from.id, 0);
        if (ctx.callbackQuery.message) {
          await ctx.editMessageText(market.message, {
            reply_markup: market.keyboard,
            parse_mode: 'Markdown',
          });
        }
      } else {
        await ctx.answerCallbackQuery(result.message.slice(0, 190));
      }
    } else if (closeMatch) {
      // Close market
      await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText('🏪 Маркет закрыт. Возвращайтесь завтра!');
      }
    }
  } catch (error: any) {
    await ctx.answerCallbackQuery(error.message || '❌ Ошибка');
  }
}
