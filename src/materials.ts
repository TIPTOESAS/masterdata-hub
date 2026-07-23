// Matières avec texture (close-up) pour certaines valeurs d'attribut.
// Le libellé d'attribut Odoo est reconnu par sous-chaîne (oak / laminate / venezia).
export interface Material { key: string; img: string; color: string; }

const B = process.env.PUBLIC_URL || '';
export const MATERIALS: Material[] = [
  { key: 'oak', img: B + '/materials/oak.jpg', color: '#d8bd93' },          // chêne / oak veneer
  { key: 'venezia', img: B + '/materials/venezia.jpg', color: '#ededed' },  // recycled plastic venezia
  { key: 'laminate', img: B + '/materials/laminate.jpg', color: '#f4f4f4' },// white laminate
  { key: 'inox', img: B + '/materials/inox.jpg', color: '#c7c9cc' },        // inox brossé / stainless (CORE)
];

// Sous-chaînes d'attribut -> matière. Plusieurs alias possibles pointant vers la même texture.
const ALIASES: Record<string, string> = {
  oak: 'oak', chene: 'oak', chêne: 'oak',
  venezia: 'venezia', venise: 'venezia',
  laminate: 'laminate', stratifie: 'laminate', stratifié: 'laminate',
  inox: 'inox', stainless: 'inox', brosse: 'inox', brossé: 'inox',
};

export function materialFor(attr: string): Material | undefined {
  const a = (attr || '').toLowerCase();
  for (const alias in ALIASES) if (a.includes(alias)) return MATERIALS.find((m) => m.key === ALIASES[alias]);
  return undefined;
}
