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

const MOB_HEALTH_EMOJI_BY_SEGMENT = [
  [
    '5352812526914545838',
    '5352693315802276747',
    '5352928327822779788',
    '5353060595635626193',
    '5352597761369875344',
    '5352644327405298088',
  ],
  [
    '5352812526914545838',
    '5352693315802276747',
    '5352928327822779788',
    '5353060595635626193',
    '5352597761369875344',
    '5352861798779366269',
  ],
  [
    '5352812526914545838',
    '5352693315802276747',
    '5352928327822779788',
    '5353060595635626193',
    '5352790863099508956',
    '5352861798779366269',
  ],
  [
    '5352812526914545838',
    '5352693315802276747',
    '5352928327822779788',
    '5350282082507599465',
    '5352790863099508956',
    '5352861798779366269',
  ],
  [
    '5352812526914545838',
    '5352693315802276747',
    '5352929629197869561',
    '5350282082507599465',
    '5352790863099508956',
    '5352861798779366269',
  ],
  [
    '5352812526914545838',
    '5350669020406264874',
    '5352929629197869561',
    '5350282082507599465',
    '5352790863099508956',
    '5352861798779366269',
  ],
  [
    '5352829513510203000',
    '5350669020406264874',
    '5352929629197869561',
    '5350282082507599465',
    '5352790863099508956',
    '5352861798779366269',
  ],
] as const;

const BOSS_HEALTH_EMOJI_BY_SEGMENT = [
  [
    '5352905792129377392',
    '5352875104588048826',
    '5352846826523370229',
    '5352729805844425477',
    '5350366869456986169',
    '5352784455008295587',
  ],
  [
    '5352905792129377392',
    '5352875104588048826',
    '5352846826523370229',
    '5352729805844425477',
    '5350366869456986169',
    '5350306696965174999',
  ],
  [
    '5352905792129377392',
    '5352875104588048826',
    '5352846826523370229',
    '5352729805844425477',
    '5350510703616764508',
    '5350306696965174999',
  ],
  [
    '5352905792129377392',
    '5352875104588048826',
    '5352846826523370229',
    '5352531335405677536',
    '5350510703616764508',
    '5350306696965174999',
  ],
  [
    '5352905792129377392',
    '5352875104588048826',
    '5350454001458524859',
    '5352531335405677536',
    '5350510703616764508',
    '5350306696965174999',
  ],
  [
    '5352905792129377392',
    '5350654937208499234',
    '5350454001458524859',
    '5352531335405677536',
    '5350510703616764508',
    '5350306696965174999',
  ],
  [
    '5352540135793665255',
    '5350654937208499234',
    '5350454001458524859',
    '5352531335405677536',
    '5350510703616764508',
    '5350306696965174999',
  ],
] as const;

function formatHealthBarWithEmojis(
  currentHp: number,
  maxHp: number,
  emojiBySegment: readonly (readonly string[])[]
): string {
  const safeMaxHp = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 1;
  const safeCurrentHp = Number.isFinite(currentHp)
    ? Math.max(0, Math.min(currentHp, safeMaxHp))
    : 0;
  const segments = safeCurrentHp >= safeMaxHp
    ? 6
    : safeCurrentHp === 0
    ? 0
    : Math.min(5, Math.ceil((safeCurrentHp / safeMaxHp) * 6));
  // The supplied configurations are ordered from full (6/6) to empty (0/6).
  const emojis = emojiBySegment[6 - segments];

  return `${emojis
    .map((id) => `<tg-emoji emoji-id="${id}">❤️</tg-emoji>`)
    .join('')} (${segments}/6) (${Math.floor(safeCurrentHp)}/${Math.floor(safeMaxHp)})`;
}

export function formatHealthBar(currentHp: number, maxHp: number): string {
  return formatHealthBarWithEmojis(currentHp, maxHp, HEALTH_EMOJI_BY_SEGMENT);
}

export function formatMobHealthBar(currentHp: number, maxHp: number): string {
  return formatHealthBarWithEmojis(currentHp, maxHp, MOB_HEALTH_EMOJI_BY_SEGMENT);
}

export function formatBossHealthBar(currentHp: number, maxHp: number): string {
  return formatHealthBarWithEmojis(currentHp, maxHp, BOSS_HEALTH_EMOJI_BY_SEGMENT);
}

/**
 * Tags this module and the rest of the codebase emit on purpose. Everything
 * else that looks like markup is treated as plain text: game data such as
 * ability and item descriptions may contain a bare "<" (for example
 * "при HP < 30%"), which Telegram's HTML parser rejects as an unsupported tag.
 */
const ALLOWED_HTML_TAG = /<\/?(?:b|s|i|u|code|pre|tg-emoji|a)\b[^>]*>/gi;

export function markdownToTelegramHtml(message: string): string {
  const withMarkdown = message
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/~~(.+?)~~/gs, '<s>$1</s>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>');

  // Pull the intentional tags out before escaping so they survive, then put
  // them back untouched once the raw text has been made HTML-safe.
  const tags: string[] = [];
  const masked = withMarkdown.replace(ALLOWED_HTML_TAG, (tag) => {
    tags.push(tag);
    return `\u0000${tags.length - 1}\u0000`;
  });

  const escaped = masked
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(/\u0000(\d+)\u0000/g, (_, index) => tags[Number(index)]);
}
