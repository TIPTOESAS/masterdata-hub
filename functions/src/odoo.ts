// Client Odoo JSON-RPC + requêtes Master Data. Aucune donnée en dur : tout vient
// de la base (TEST) via /jsonrpc. Les identifiants sont injectés par secrets Firebase.

export interface OdooConfig { url: string; db: string; user: string; key: string; }

// Pricelists cibles (base TEST). Wholesale n'a pas toujours d'item variante :
// règle globale -43% sur le prix public.
const PL_PUBLIC = 1;
const PL_WHOLESALE = 1743;
const PL_USD = 1759;
const WHOLESALE_GLOBAL_DISCOUNT = 0.43;

let uidCache: number | null = null;

async function rpc(cfg: OdooConfig, service: string, method: string, args: any[]): Promise<any> {
  const res = await fetch(`${cfg.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args } }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error('Odoo: ' + JSON.stringify(json.error?.data?.message || json.error));
  return json.result;
}

async function uid(cfg: OdooConfig): Promise<number> {
  if (uidCache) return uidCache;
  uidCache = await rpc(cfg, 'common', 'authenticate', [cfg.db, cfg.user, cfg.key, {}]);
  if (!uidCache) throw new Error('Odoo: authentification échouée');
  return uidCache;
}

async function execute(cfg: OdooConfig, model: string, method: string, args: any[] = [], kwargs: any = {}): Promise<any> {
  const id = await uid(cfg);
  return rpc(cfg, 'object', 'execute_kw', [cfg.db, id, cfg.key, model, method, args, kwargs]);
}

const m2oName = (v: any): string => (Array.isArray(v) && v.length === 2 ? String(v[1]) : '');
const round2 = (n: number) => Math.round(n * 100) / 100;

const TMPL_FIELDS = [
  'name', 'default_code', 'x_super_category', 'x_collection', 'x_category', 'x_sub_category',
  'x_sub_collection', 'categ_id', 'x_studio_dimensions', 'weight', 'volume', 'barcode', 'hs_code',
  'country_of_origin', 'uom_name', 'list_price', 'standard_price', 'sale_ok', 'purchase_ok', 'active',
  'x_studio_tiptoe_ref', 'x_studio_tiptoe_type', 'x_studio_tiptoe_type_detail', 'x_studio_launch_date',
  'x_studio_woo_tmpl_id', 'x_studio_transport_cost', 'image_128',
];
const VAR_FIELDS = [
  'default_code', 'barcode', 'lst_price', 'standard_price', 'weight', 'volume', 'product_tmpl_id',
  'product_template_attribute_value_ids', 'x_studio_dimensions_variant', 'x_studio_hs_code_variant',
  'x_studio_country_of_origin_variant', 'x_studio_diameter', 'x_studio_dimensions_packed',
  'x_studio_flatpack', 'x_studio_gamme_famille_spidy', 'x_studio_product_state',
  'x_studio_saleable_in_wholesale', 'x_available_qty', 'x_next_supply_qty', 'x_next_supply_date',
  'x_studio_char_field_6T0cm', 'create_date',
];

// Libellés exacts de l'export Odoo « Product (product.product) » à répliquer, dans l'ordre.
const EXPORT_LABELS = [
  'Available in b2b', 'Internal Reference', 'Barcode', 'Name', 'Display Name', 'Category', 'Subcategory',
  'Collection', 'Sous-collection', 'Variant Values', 'Variant material', 'Product Category', 'TipToe Type',
  'Country of Origin (variant)', 'Detailed countries of origin', 'HS code (variant)', 'Code ecopart',
  'Ecopart unitaire HT', 'Labels', 'Lacquers', 'Fire resistance', 'Standard EURO', 'EPD', 'VOC', 'FSC - PEFC',
  'Guarantee', 'Recycled material', 'Dimensions (variant)', 'Dimensions packed', 'Seat height', 'Diameter',
  'Weight (variant)', 'Assembly type', 'Average supply time', 'Average delivery time', 'Flatpack',
];

// Export au format Odoo (via export_data : m2o -> display, selection -> label) pour des variantes données.
export async function exportVariants(cfg: OdooConfig, ids: number[]): Promise<{ headers: string[]; rows: any[][] }> {
  if (!ids.length) return { headers: [], rows: [] };
  const fg: any = await execute(cfg, 'product.product', 'fields_get', [], { attributes: ['string'] });
  const byLabel: Record<string, string> = {};
  for (const name in fg) { const s = fg[name]?.string; if (s && !(s in byLabel)) byLabel[s] = name; }
  const cols = EXPORT_LABELS.map((l) => ({ label: l, field: byLabel[l] })).filter((c) => c.field);
  const res: any = await execute(cfg, 'product.product', 'export_data', [ids, cols.map((c) => c.field)]);
  return { headers: cols.map((c) => c.label), rows: res?.datas || [] };
}

// data: URL à partir d'un base64 Odoo (détection du format sur la signature).
function imgDataUrl(b64: string | false): string {
  if (!b64) return '';
  let mime = 'image/png';
  if (b64.startsWith('/9j/')) mime = 'image/jpeg';
  else if (b64.startsWith('R0lGOD')) mime = 'image/gif';
  else if (b64.startsWith('UklGR')) mime = 'image/webp';
  return `data:${mime};base64,${b64}`;
}

// Liste des templates + variantes + pricing + fournisseur par défaut.
export async function listProducts(cfg: OdooConfig, opts: { limit?: number; domain?: any[] } = {}): Promise<any[]> {
  const limit = opts.limit ?? 3000;
  const domain = opts.domain ?? [['active', '=', true]];
  const tmpls: any[] = await execute(cfg, 'product.template', 'search_read', [domain],
    { fields: TMPL_FIELDS, limit, order: 'name' });
  const tmplIds = tmpls.map((t) => t.id);
  if (!tmplIds.length) return [];

  const [variants, suppliers] = await Promise.all([
    execute(cfg, 'product.product', 'search_read', [[['product_tmpl_id', 'in', tmplIds]]], { fields: VAR_FIELDS }),
    execute(cfg, 'product.supplierinfo', 'search_read', [[['product_tmpl_id', 'in', tmplIds]]],
      { fields: ['product_tmpl_id', 'partner_id', 'sequence'], order: 'sequence' }),
  ]);

  // noms des valeurs d'attributs (pour libeller les variantes)
  const avidSet = new Set<number>();
  variants.forEach((v: any) => (v.product_template_attribute_value_ids || []).forEach((id: number) => avidSet.add(id)));
  const avNames: Record<number, string> = {};
  if (avidSet.size) {
    const avs: any[] = await execute(cfg, 'product.template.attribute.value', 'read',
      [Array.from(avidSet)], { fields: ['name'] });
    avs.forEach((a) => (avNames[a.id] = a.name));
  }

  const varIds = variants.map((v: any) => v.id);

  // external id (ir.model.data) par variante — utile pour export / intégrations
  const extRecs: any[] = varIds.length ? await execute(cfg, 'ir.model.data', 'search_read',
    [[['model', '=', 'product.product'], ['res_id', 'in', varIds]]], { fields: ['res_id', 'module', 'name'] }) : [];
  const extByVar: Record<number, string> = {};
  extRecs.forEach((e) => { extByVar[e.res_id] = `${e.module}.${e.name}`; });

  // pricing par variante
  const items: any[] = varIds.length ? await execute(cfg, 'product.pricelist.item', 'search_read',
    [[['pricelist_id', 'in', [PL_PUBLIC, PL_WHOLESALE, PL_USD]], ['product_id', 'in', varIds]]],
    { fields: ['pricelist_id', 'product_id', 'fixed_price', 'compute_price'] }) : [];
  const priceByVar: Record<number, { pub: number | null; whol: number | null; usd: number | null }> = {};
  items.forEach((it) => {
    const pid = Array.isArray(it.product_id) ? it.product_id[0] : it.product_id;
    const pl = Array.isArray(it.pricelist_id) ? it.pricelist_id[0] : it.pricelist_id;
    if (!priceByVar[pid]) priceByVar[pid] = { pub: null, whol: null, usd: null };
    if (it.compute_price === 'fixed') {
      if (pl === PL_PUBLIC) priceByVar[pid].pub = it.fixed_price;
      else if (pl === PL_WHOLESALE) priceByVar[pid].whol = it.fixed_price;
      else if (pl === PL_USD) priceByVar[pid].usd = it.fixed_price;
    }
  });

  // fournisseur par défaut (1er par séquence)
  const supByTmpl: Record<number, string> = {};
  suppliers.forEach((s: any) => {
    const tid = Array.isArray(s.product_tmpl_id) ? s.product_tmpl_id[0] : s.product_tmpl_id;
    if (!(tid in supByTmpl)) supByTmpl[tid] = m2oName(s.partner_id);
  });

  // variantes groupées par template
  const varsByTmpl: Record<number, any[]> = {};
  variants.forEach((v: any) => {
    const tid = Array.isArray(v.product_tmpl_id) ? v.product_tmpl_id[0] : v.product_tmpl_id;
    const pr = priceByVar[v.id] || { pub: null, whol: null, usd: null };
    const pub = pr.pub;
    const whol = pr.whol != null ? pr.whol : (pub != null ? round2(pub * (1 - WHOLESALE_GLOBAL_DISCOUNT)) : null);
    (varsByTmpl[tid] ||= []).push({
      id: v.id,
      sku: v.default_code || '',
      attr: (v.product_template_attribute_value_ids || []).map((id: number) => avNames[id]).filter(Boolean).join(' / ') || 'variante unique',
      color: '',
      state: v.x_studio_product_state || '',
      b2b: !!v.x_studio_saleable_in_wholesale,
      availQty: v.x_available_qty || 0,
      nextSupplyQty: v.x_next_supply_qty || 0,
      nextSupplyDate: v.x_next_supply_date || '',
      supplier: v.x_studio_char_field_6T0cm || '',
      externalId: extByVar[v.id] || '',
      createdOn: (v.create_date || '').slice(0, 10),
      barcode: v.barcode || '',
      price: v.lst_price || 0,
      cost: v.standard_price || 0,
      weight: v.weight || 0,
      volume: v.volume || 0,
      dimVariant: v.x_studio_dimensions_variant || '',
      hsVariant: v.x_studio_hs_code_variant || '',
      origin: m2oName(v.x_studio_country_of_origin_variant) || '',
      diameter: v.x_studio_diameter || '',
      dimPacked: v.x_studio_dimensions_packed || '',
      flatpack: v.x_studio_flatpack || '',
      spidy: v.x_studio_gamme_famille_spidy || '',
      pricePublic: pub,
      priceWholesale: whol,
      priceUsd: pr.usd,
    });
  });

  return tmpls.map((t) => {
    const tvars = varsByTmpl[t.id] || [];
    const states = Array.from(new Set(tvars.map((v: any) => v.state).filter(Boolean)));
    return {
    id: t.id,
    code: t.default_code || '',
    image: imgDataUrl(t.image_128),
    productState: states[0] || '',
    b2b: tvars.some((v: any) => v.b2b) ? 'Oui' : 'Non',
    name: t.name || '',
    nameEn: t.name || '',
    nameDe: t.name || '',
    superCat: t.x_super_category || '',
    collection: t.x_collection || '',
    cat: t.x_category || '',
    sub: t.x_sub_category || '',
    subcol: t.x_sub_collection || '',
    odooCat: m2oName(t.categ_id),
    dim: t.x_studio_dimensions || '',
    weight: t.weight || 0,
    volume: t.volume || 0,
    barcode: t.barcode || '',
    hs: t.hs_code || '',
    origin: m2oName(t.country_of_origin),
    uom: t.uom_name || '',
    pack: '',
    transport: t.x_studio_transport_cost || 0,
    price: t.list_price || 0,
    cost: t.standard_price || 0,
    saleOk: !!t.sale_ok,
    buyOk: !!t.purchase_ok,
    active: !!t.active,
    supplier: tvars.map((v: any) => v.supplier).find(Boolean) || supByTmpl[t.id] || '',
    tiptoeRef: t.x_studio_tiptoe_ref || '',
    tiptoeType: t.x_studio_tiptoe_type || '',
    tiptoeTypeDetail: m2oName(t.x_studio_tiptoe_type_detail),
    launch: t.x_studio_launch_date || '',
    woo: t.x_studio_woo_tmpl_id || '',
    variants: varsByTmpl[t.id] || [],
    };
  });
}

// Traductions d'un template (nom par langue).
export async function getTranslations(cfg: OdooConfig, tmplId: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const lang of ['en_US', 'fr_FR', 'de_DE']) {
    const r: any[] = await execute(cfg, 'product.template', 'read', [[tmplId]], { fields: ['name'], context: { lang } });
    out[lang] = r[0]?.name || '';
  }
  return out;
}

// Nomenclatures (mrp.bom) : pour un template donné ou les N dernières.
export async function listBoms(cfg: OdooConfig, opts: { productTmplId?: number | null; limit?: number } = {}): Promise<any[]> {
  const domain = opts.productTmplId ? [['product_tmpl_id', '=', opts.productTmplId]] : [];
  const boms: any[] = await execute(cfg, 'mrp.bom', 'search_read', [domain],
    { fields: ['product_tmpl_id', 'code', 'type', 'product_qty', 'product_uom_id', 'bom_line_ids'], limit: opts.limit ?? 200, order: 'id desc' });
  if (!boms.length) return [];
  const lineIds = boms.flatMap((b) => b.bom_line_ids || []);
  const lines: any[] = lineIds.length ? await execute(cfg, 'mrp.bom.line', 'read', [lineIds],
    { fields: ['bom_id', 'product_id', 'product_qty', 'product_uom_id'] }) : [];
  const compIds = lines.map((l) => (Array.isArray(l.product_id) ? l.product_id[0] : l.product_id));
  const comps: any[] = compIds.length ? await execute(cfg, 'product.product', 'read', [compIds],
    { fields: ['default_code', 'name'] }) : [];
  const compById: Record<number, any> = {};
  comps.forEach((c) => (compById[c.id] = c));
  const linesByBom: Record<number, any[]> = {};
  lines.forEach((l) => {
    const bid = Array.isArray(l.bom_id) ? l.bom_id[0] : l.bom_id;
    const pid = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
    (linesByBom[bid] ||= []).push({
      productId: pid,
      code: compById[pid]?.default_code || '',
      name: compById[pid]?.name || '',
      qty: l.product_qty || 0,
      uom: m2oName(l.product_uom_id),
    });
  });
  // hiérarchie + code SKU du produit parent (pour le panel de filtres BOM)
  const tids = Array.from(new Set(boms.map((b) => (Array.isArray(b.product_tmpl_id) ? b.product_tmpl_id[0] : b.product_tmpl_id))));
  const parents: any[] = tids.length ? await execute(cfg, 'product.template', 'read', [tids],
    { fields: ['default_code', 'x_super_category', 'x_collection', 'x_category', 'x_sub_category'] }) : [];
  const parentById: Record<number, any> = {};
  parents.forEach((p) => (parentById[p.id] = p));
  return boms.map((b) => {
    const tid = Array.isArray(b.product_tmpl_id) ? b.product_tmpl_id[0] : b.product_tmpl_id;
    const par = parentById[tid] || {};
    return {
      id: b.id,
      productTmplId: tid,
      productName: m2oName(b.product_tmpl_id),
      parentCode: par.default_code || '',
      superCat: par.x_super_category || '',
      collection: par.x_collection || '',
      cat: par.x_category || '',
      sub: par.x_sub_category || '',
      code: b.code || '',
      type: b.type || 'normal',
      qty: b.product_qty || 1,
      lines: linesByBom[b.id] || [],
    };
  });
}

// Écriture générique (write) sur un enregistrement.
export async function writeRecord(cfg: OdooConfig, model: string, id: number, values: Record<string, any>): Promise<boolean> {
  return execute(cfg, model, 'write', [[id], values]);
}

// Écriture des mêmes valeurs sur plusieurs enregistrements (write en masse).
export async function writeRecords(cfg: OdooConfig, model: string, ids: number[], values: Record<string, any>): Promise<boolean> {
  if (!ids.length) return false;
  return execute(cfg, model, 'write', [ids, values]);
}
