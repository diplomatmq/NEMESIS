const HEALTH_EMOJI_BY_SEGMENT = [
  [
    '5348334070025726448',
    '5348075594598887668',
    '5348075594598887668',
    '5345793541035565779',
    '5348286082356128318',
    '5348555308086113762',
  ],
  [
    '5348334070025726448',
    '5348075594598887668',
    '5345886475537919278',
    '5345793541035565779',
    '5348286082356128318',
    '5348274481649462971',
  ],
  [
    '5348334070025726448',
    '5348075594598887668',
    '5345886475537919278',
    '5345793541035565779',
    '5346098634037439636',
    '5348274481649462971',
  ],
  [
    '5348334070025726448',
    '5348075594598887668',
    '5345886475537919278',
    '5348153071513938776',
    '5346098634037439636',
    '5348274481649462971',
  ],
  [
    '5348334070025726448',
    '5348075594598887668',
    '5348112973699262244',
    '5348153071513938776',
    '5346098634037439636',
    '5348274481649462971',
  ],
  [
    '5348334070025726448',
    '5346079676051793478',
    '5348112973699262244',
    '5348153071513938776',
    '5346098634037439636',
    '5348274481649462971',
  ],
  [
    '5345918670612768794',
    '5346079676051793478',
    '5348112973699262244',
    '5348153071513938776',
    '5346098634037439636',
    '5348274481649462971',
  ],
] as const;

export function formatHealthBar(currentHp: number, maxHp: number): string {
  const safeMaxHp = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 1;
  const safeCurrentHp = Number.isFinite(currentHp)
    ? Math.max(0, Math.min(currentHp, safeMaxHp))
    : 0;
  const segments = safeCurrentHp >= safeMaxHp
    ? 6
    : safeCurrentHp === 0
    ? 0
    : Math.min(5, Math.ceil((safeCurrentHp / safeMaxHp) * 6));
  const emojis = HEALTH_EMOJI_BY_SEGMENT[segments];

  return `${emojis
    .map((id) => `<tg-emoji emoji-id="${id}">❤️</tg-emoji>`)
    .join('')} (${Math.floor(safeCurrentHp)}/${Math.floor(safeMaxHp)})`;
}

export function markdownToTelegramHtml(message: string): string {
  return message
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/~~(.+?)~~/gs, '<s>$1</s>');
}
