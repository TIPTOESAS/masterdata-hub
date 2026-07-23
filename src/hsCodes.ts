// Descriptions des rubriques HS/NC (6 chiffres) utilisées par TIPTOE.
// Source : nomenclature douanière (Système Harmonisé 2022 / Nomenclature Combinée UE),
// recoupée sur le web. Sert d'aide à la saisie du code HS variante (liste non bloquante).
export const HS_DESC: Record<string, string> = {
  '940310': 'Mobilier métallique de bureau',
  '940320': 'Autres meubles en métal',
  '940330': 'Mobilier en bois de bureau',
  '940360': 'Autres meubles en bois',
  '940370': 'Meubles en matières plastiques',
  '940390': 'Parties de meubles',
  '940391': 'Parties de meubles, en bois',
  '940399': 'Parties de meubles, en autres matières',
  '940141': 'Sièges transformables en lits, à bâti en bois',
  '940161': 'Sièges à bâti en bois, rembourrés',
  '940171': 'Sièges à bâti métallique, rembourrés',
  '940179': 'Sièges à bâti métallique, non rembourrés',
  '940180': 'Autres sièges (n.d.a.)',
  '940191': 'Parties de sièges, en bois',
  '940421': 'Matelas en caoutchouc ou plastique alvéolaire',
  '940490': 'Articles de literie (couettes, coussins, oreillers…)',
  '480256': 'Papier non couché (écriture/impression), 40–150 g/m²',
  '480810': 'Papier et carton ondulés',
  '491110': 'Imprimés publicitaires, catalogues commerciaux',
  '491191': 'Images, gravures et photographies imprimées',
  '511211': 'Tissus de laine peignée, ≤ 200 g/m²',
  '540753': 'Tissus de filaments synthétiques, teints',
  '630499': "Autres articles d'ameublement, en matières textiles",
  '320820': 'Peintures et vernis (polymères acryliques ou vinyliques)',
  '390730': 'Résines époxydes, sous formes primaires',
  '391990': 'Plaques, feuilles et films auto-adhésifs en plastique',
  '731815': 'Vis et boulons filetés, en fer ou acier',
  '732611': 'Boulets pour broyeurs, en fer ou acier',
  '830250': 'Patères, supports et articles similaires, en métaux communs',
  '830400': 'Classeurs, fichiers et matériel de bureau, en métaux communs',
  '831000': 'Plaques indicatrices, enseignes, en métaux communs',
  '853951': 'Modules à diodes électroluminescentes (LED)',
};

// Normalise un code HS brut (ex. "9401710000 80 - Y904") -> 6 chiffres.
export const hs6 = (raw: string): string => (raw || '').replace(/\D/g, '').slice(0, 6);

export const hsDescription = (raw: string): string => HS_DESC[hs6(raw)] || '';
