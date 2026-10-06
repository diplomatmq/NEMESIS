import { FloorEventType } from '../types/game.types';

export interface TowerEvent {
  type: FloorEventType;
  title: string;
  description: string;
  icon: string;
}

export class TowerEventService {
  
  determineFloorEvent(floor: number): FloorEventType {
    // Every 10th floor is a boss
    if (floor % 10 === 0) {
      return FloorEventType.BOSS;
    }

    // Elite enemies every 5th floor (but not boss floors)
    if (floor % 5 === 0) {
      return FloorEventType.ELITE;
    }

    // Random event distribution
    const random = Math.random();

    if (random < 0.60) {
      return FloorEventType.COMBAT; // 60% regular combat
    } else if (random < 0.70) {
      return FloorEventType.TREASURE; // 10% treasure
    } else if (random < 0.80) {
      return FloorEventType.MERCHANT; // 10% merchant
    } else if (random < 0.90) {
      return FloorEventType.EVENT; // 10% event
    } else if (random < 0.95) {
      return FloorEventType.CHALLENGE; // 5% challenge
    } else {
      return FloorEventType.RISK_REWARD; // 5% risk/reward
    }
  }

  generateEventDescription(event: FloorEventType, floor: number): TowerEvent {
    switch (event) {
      case FloorEventType.BOSS:
        return {
          type: event,
          title: '👑 БОСС ЭТАЖА',
          description: `Перед вами стоит могущественный босс этажа ${floor}!`,
          icon: '👑',
        };

      case FloorEventType.ELITE:
        return {
          type: event,
          title: '👹 Элитный противник',
          description: 'Особо опасный враг преграждает ваш путь!',
          icon: '👹',
        };

      case FloorEventType.TREASURE:
        return {
          type: event,
          title: '💰 Сокровищница',
          description: 'Вы нашли древнюю сокровищницу!',
          icon: '💰',
        };

      case FloorEventType.MERCHANT:
        return {
          type: event,
          title: '🛒 Торговец',
          description: 'Странный торговец предлагает свои товары.',
          icon: '🛒',
        };

      case FloorEventType.CHALLENGE:
        return {
          type: event,
          title: '🧩 Испытание',
          description: 'Мистическое испытание ждёт вас.',
          icon: '🧩',
        };

      case FloorEventType.RISK_REWARD:
        return {
          type: event,
          title: '🔥 Риск и награда',
          description: 'Опасный выбор - большой риск, большая награда.',
          icon: '🔥',
        };

      case FloorEventType.EVENT:
        return {
          type: event,
          title: '🕯️ Событие',
          description: this.getRandomEventDescription(),
          icon: '🕯️',
        };

      case FloorEventType.COMBAT:
      default:
        return {
          type: event,
          title: '⚔️ Битва',
          description: 'Враг готов сразиться с вами!',
          icon: '⚔️',
        };
    }
  }

  private getRandomEventDescription(): string {
    const events = [
      'Вы находите древний алтарь.',
      'Таинственный голос предлагает выбор.',
      'Призрак прошлого хочет поговорить.',
      'Магический портал мерцает перед вами.',
      'Вы слышите странные звуки в темноте.',
    ];
    
    return events[Math.floor(Math.random() * events.length)];
  }

  // Generate treasure rewards
  generateTreasureReward(floor: number): { gold: number; message: string } {
    const baseGold = 50 + (floor * 3);
    const randomMultiplier = 1 + Math.random(); // 1x to 2x
    const gold = Math.floor(baseGold * randomMultiplier);

    let message = `💰 Вы открываете сокровищницу!\n\n`;
    message += `💎 Найдено: ${gold} золота!\n`;

    // Chance for extra item
    if (Math.random() < 0.5) {
      message += `📦 Также найден редкий предмет!`;
    }

    return { gold, message };
  }

  // Generate merchant inventory
  generateMerchantOffer(floor: number): string {
    const level = Math.floor(floor / 10) + 1;
    
    let message = `🛒 **Торговец башни**\n\n`;
    message += `"Добро пожаловать, путник!"\n\n`;
    message += `📦 Товары:\n`;
    message += `⚔️ Стальной меч +${5 + level * 2} ATK - ${100 + level * 50} золота\n`;
    message += `🛡️ Железная броня +${10 + level * 3} DEF - ${150 + level * 75} золота\n`;
    message += `💊 Зелье лечения +50 HP - 50 золота\n\n`;
    message += `(Система покупки будет добавлена позже)`;

    return message;
  }

  // Generate challenge
  generateChallenge(floor: number): string {
    const challenges = [
      {
        title: '🧩 Загадка Сфинкса',
        description: 'Ответьте правильно и получите награду.',
        reward: 'Редкий предмет',
      },
      {
        title: '⚖️ Испытание силы',
        description: 'Сразитесь без защиты.',
        reward: '+50% урон на 3 боя',
      },
      {
        title: '🎲 Азартная игра',
        description: 'Поставьте золото на кон.',
        reward: 'Удвоение ставки или потеря',
      },
    ];

    const challenge = challenges[Math.floor(Math.random() * challenges.length)];

    return `${challenge.title}\n\n${challenge.description}\n\n🎁 Награда: ${challenge.reward}\n\n(Система испытаний будет добавлена позже)`;
  }
}

export const towerEventService = new TowerEventService();
