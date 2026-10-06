// Game Types

export enum GameClass {
  BERSERKER = 'berserker',
  GUARDIAN = 'guardian',
  ASSASSIN = 'assassin',
  VAMPIRE = 'vampire',
  ARCANIST = 'arcanist',
  TACTICIAN = 'tactician',
  JESTER = 'jester',
  NECROMANCER = 'necromancer'
}

export enum ActionType {
  ATTACK = 'attack',
  DEFEND = 'defend',
  SKILL = 'skill',
  ITEM = 'item',
  FLEE = 'flee'
}

export enum FloorEventType {
  COMBAT = 'combat',
  ELITE = 'elite',
  TREASURE = 'treasure',
  MERCHANT = 'merchant',
  CHALLENGE = 'challenge',
  RISK_REWARD = 'risk_reward',
  EVENT = 'event',
  BOSS = 'boss'
}

export enum ItemRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
  MYTHIC = 'mythic'
}

export enum ItemSlot {
  WEAPON = 'weapon',
  SHIELD = 'shield',
  HELMET = 'helmet',
  ARMOR = 'armor',
  BOOTS = 'boots',
  ACCESSORY = 'accessory'
}

export interface PlayerStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  critChance: number;
  dodge: number;
  lifesteal: number;
  aiResist: number;
  resist: number;
}

export interface EnemyStats extends PlayerStats {
  name: string;
  level: number;
  abilities: string[];
}

export interface CombatAction {
  type: ActionType;
  userId: number;
  chatId: number;
  timestamp: Date;
}

export interface CombatResult {
  success: boolean;
  playerDamage: number;
  enemyDamage: number;
  playerHp: number;
  enemyHp: number;
  isCrit: boolean;
  isDodge: boolean;
  message: string;
  enemyDefeated: boolean;
  playerDefeated: boolean;
  loot?: any[];
  xpGained?: number;
}

export interface BehaviorProfile {
  userId: number;
  chatId: number;
  attackRate: number;
  defendRate: number;
  aggression: number;
  predictability: number;
  recentActions: ActionType[];
  afterBigDamage: string;
  commonSequences: string[];
}

export interface PendingPayment {
  id: number;
  userId: number;
  chatId: number;
  action: string;
  payload: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'expired';
}

export interface Season {
  id: number;
  seasonNumber: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  totalFloors: number;
  zonesCount: number;
}
