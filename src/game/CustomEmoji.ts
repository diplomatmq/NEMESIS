export const CUSTOM_EMOJI = {
  planet: '5399898266265475100',
  status: '5249026407438229507',
  user: '5974048815789903111',
  class: '5359441070201513074',
  season: '5409008750893734809',
  floor: '5429403746696189687',
  checkpoint: '5460755126761312667',
  attack: '5408935401442267103',
  defense: '5354883723353435504',
  gold: '5318912792428814144',
  home: '5235882793900188063',
} as const;

export function ce(id: string, fallback: string): string {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}
