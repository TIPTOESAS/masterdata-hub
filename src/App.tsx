import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { onAuthChange, signOutUser } from './services/auth';
import { fetchProducts, fetchBoms, writeOdoo, writeManyOdoo, fetchExport } from './services/odoo';
import { Product, Variant, Bom } from './types';
import { colorFor } from './colors';
import { materialFor } from './materials';
import { hsDescription } from './hsCodes';
import Login from './components/Login';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// Rend un EAN-13 (ou CODE128) en code-barres SVG.
const Barcode: React.FC<{ value: string }> = ({ value }) => {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: /^\d{13}$/.test(value) ? 'EAN13' : 'CODE128',
        width: 2, height: 50, fontSize: 14, margin: 6, background: 'transparent',
      });
    } catch { /* code invalide : on n'affiche rien */ }
  }, [value]);
  if (!value) return <span className="cap">pas de code-barres</span>;
  return <svg ref={ref} className="barcode" />;
};

const money = (v: number | null, cur = '€') =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
// Prix de vente affiché = toujours le Public Pricelist HT (fallback list_price si absent).
const pubPrice = (v: { pricePublic: number | null; price: number }) => (v.pricePublic != null ? v.pricePublic : v.price);
// Indicateur booléen : coche verte si vrai, tiret grisé sinon.
const flag = (b: boolean) => <span className={'flag' + (b ? ' on' : '')}>{b ? '✓' : '—'}</span>;
// Style de vignette : texture matière si reconnue, sinon couleur de la palette.
const swatchStyle = (attr: string, color?: string): React.CSSProperties => {
  const m = materialFor(attr);
  if (m) return { backgroundImage: `url("${m.img}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: colorFor(attr) || color || '#ccd1d8' };
};
const cap = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

const TMPL_MAP: Record<string, string> = {
  name: 'name', code: 'default_code', tiptoeRef: 'x_studio_tiptoe_ref', price: 'list_price', cost: 'standard_price',
  tiptoeType: 'x_studio_tiptoe_type', launch: 'x_studio_launch_date', saleOk: 'sale_ok', buyOk: 'purchase_ok', active: 'active',
  superCat: 'x_super_category', collection: 'x_collection', cat: 'x_category', sub: 'x_sub_category', subcol: 'x_sub_collection',
  dim: 'x_studio_dimensions', weight: 'weight', volume: 'volume', barcode: 'barcode', hs: 'hs_code', transport: 'x_studio_transport_cost',
};
const VAR_MAP: Record<string, string> = {
  sku: 'default_code', barcode: 'barcode', cost: 'standard_price', weight: 'weight', volume: 'volume',
  dimVariant: 'x_studio_dimensions_variant', hsVariant: 'x_studio_hs_code_variant', diameter: 'x_studio_diameter',
  dimPacked: 'x_studio_dimensions_packed', flatpack: 'x_studio_flatpack', spidy: 'x_studio_gamme_famille_spidy',
  b2b: 'x_studio_saleable_in_wholesale', supplier: 'x_studio_char_field_6T0cm',
};
const NUMERIC = new Set(['price', 'cost', 'weight', 'volume', 'transport']);
// Admins autorisés à écrire dans Odoo. Les autres @tiptoe.fr sont en lecture seule.
const ADMIN_EMAILS = new Set(['bastien@tiptoe.fr', 'brice@tiptoe.fr']);

const STATES: [string, string][] = [['dev', 'Development'], ['soon', 'Upcoming'], ['prod', 'Active'], ['end_of_life', 'End of Life'], ['old', 'Old']];
const stateLabel = (s: string) => STATES.find((x) => x[0] === s)?.[1] || s || '—';

// Couleur déterministe par TipToe type (hash -> palette) pour distinguer les badges d'un coup d'œil.
const TT_PALETTE: [string, string][] = [
  ['#e6effc', '#2760a0'], ['#e2f3e9', '#1f7a44'], ['#fbeecd', '#8a6510'], ['#efeaf6', '#6a4a86'],
  ['#fce4e4', '#b02a2a'], ['#cdeae4', '#0a7c66'], ['#f5e6cd', '#8a5a1a'], ['#e0e7ef', '#3a4757'],
];
const ttStyle = (t: string): React.CSSProperties => {
  if (!t) return {};
  let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const [bg, fg] = TT_PALETTE[h % TT_PALETTE.length];
  return { background: bg, color: fg };
};

type Edits = Record<string, string | boolean>;

// clé de facette -> propriété du produit
type FKey = 'superCat' | 'collection' | 'cat' | 'sub' | 'subcol' | 'supplier' | 'productState' | 'tiptoeType' | 'b2b';
const FACETS: { key: FKey; label: string; scroll?: boolean; state?: boolean; order?: string[] }[] = [
  { key: 'b2b', label: 'Catalogue B2B', order: ['Oui', 'Non'] },
  { key: 'tiptoeType', label: 'TipToe type', scroll: true },
  { key: 'productState', label: 'Statut', state: true },
  { key: 'superCat', label: 'Super-catégorie' },
  { key: 'collection', label: 'Collection', scroll: true },
  { key: 'subcol', label: 'Sous-collection', scroll: true },
  { key: 'cat', label: 'Catégorie', scroll: true },
  { key: 'sub', label: 'Sous-catégorie', scroll: true },
  { key: 'supplier', label: 'Fournisseur par défaut', scroll: true },
];

// Panneau de filtres rétractable / élargissable (blocs côte à côte en mode large).
const FilterRail: React.FC<{ activeCount: number; children: React.ReactNode }> = ({ activeCount, children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(false);
  if (collapsed) return (
    <aside className="rail collapsed">
      <button className="railtoggle" title="Afficher les filtres" onClick={() => setCollapsed(false)}>⟩</button>
      <div className="railvlabel">Filtres{activeCount ? ` · ${activeCount}` : ''}</div>
    </aside>
  );
  return (
    <aside className={'rail' + (wide ? ' wide' : '')}>
      <div className="railhead">
        <span className="railtitle">Filtres {activeCount > 0 && <span className="railn">{activeCount}</span>}</span>
        <span className="railbtns">
          <button className={'railbtn' + (wide ? ' on' : '')} title={wide ? 'Une colonne' : 'Élargir (colonnes côte à côte)'} onClick={() => setWide(!wide)}>⊞</button>
          <button className="railbtn" title="Réduire" onClick={() => setCollapsed(true)}>⟨</button>
        </span>
      </div>
      <div className={'facets' + (wide ? ' wide' : '')}>{children}</div>
    </aside>
  );
};

// ============================== App root ==============================
const App: React.FC = () => {
  const [user, setUser] = useState<any>(undefined); // undefined = chargement
  useEffect(() => onAuthChange(setUser), []);
  if (user === undefined) return <div className="loading">Chargement…</div>;
  if (!user) return <Login />;
  return <Hub user={user} />;
};

// ============================== Hub ==============================
const Hub: React.FC<{ user: any }> = ({ user }) => {
  const [view, setView] = useState<'products' | 'boms'>('products');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [q, setQ] = useState('');
  const isAdmin = ADMIN_EMAILS.has((user.email || '').toLowerCase());

  useEffect(() => { fetchProducts().then(setProducts); }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo"><img className="mark" src={process.env.PUBLIC_URL + '/favicon.svg'} alt="" />Master Data Hub <span className="sub">· Produits</span></div>
        <div className="nav">
          <button className={view === 'products' ? 'on' : ''} onClick={() => setView('products')}>Produits</button>
          <button className={view === 'boms' ? 'on' : ''} onClick={() => setView('boms')}>Nomenclatures</button>
        </div>
        <div className="gsearch"><span className="mag">🔍</span>
          <input placeholder="Rechercher réf, nom, code-barres…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="env">
          <span className="badge-env">● ODOO · TEST</span>
          <span className={'badge-role' + (isAdmin ? ' admin' : '')} title={isAdmin ? 'Vous pouvez modifier dans Odoo' : 'Lecture seule — écriture réservée aux admins'}>{isAdmin ? 'ADMIN' : 'LECTURE'}</span>
          <span className="av" title={user.email} onClick={() => signOutUser()}>
            {(user.email || '?')[0].toUpperCase()}</span>
        </div>
      </div>
      {view === 'products'
        ? <ProductsView products={products} setProducts={setProducts} q={q.toLowerCase()} isAdmin={isAdmin} />
        : <BomView q={q.toLowerCase()} />}
    </div>
  );
};

// ============================== Products view ==============================
const emptySets = (): Record<FKey, Set<string>> =>
  ({ superCat: new Set(), collection: new Set(), cat: new Set(), sub: new Set(), subcol: new Set(), tiptoeType: new Set(), supplier: new Set(), productState: new Set(), b2b: new Set() });

const ProductsView: React.FC<{
  products: Product[] | null; setProducts: (p: Product[]) => void; q: string; isAdmin: boolean;
}> = ({ products, setProducts, q, isAdmin }) => {
  const [sets, setSets] = useState<Record<FKey, Set<string>>>(emptySets());
  const [status, setStatus] = useState('active');
  const [sel, setSel] = useState<{ product: Product; variantId: number | null } | null>(null);
  const [selVar, setSelVar] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'template', dir: 1 });

  const toggle = (key: FKey, v: string) => {
    setSets((s) => { const n = { ...s, [key]: new Set(s[key]) }; n[key].has(v) ? n[key].delete(v) : n[key].add(v); return n; });
  };
  const clear = (key: FKey) => setSets((s) => ({ ...s, [key]: new Set() }));

  // match applique tous les filtres, sauf éventuellement `except` (pour le comptage dynamique).
  const match = useCallback((p: Product, except?: FKey) => {
    for (const { key } of FACETS) {
      if (key === except) continue;
      if (sets[key].size && !sets[key].has(String(p[key] as any))) return false;
    }
    if (status === 'active' && !p.active) return false;
    if (status === 'archived' && p.active) return false;
    if (status === 'sale' && !p.saleOk) return false;
    if (status === 'purchase' && !p.buyOk) return false;
    if (q) {
      const base = (p.code + ' ' + p.name + ' ' + p.nameEn + ' ' + p.barcode + ' ' + p.tiptoeRef).toLowerCase();
      // recherche aussi par SKU / code-barres / attribut de variante
      const inVariants = p.variants.some((v) => (v.sku + ' ' + v.barcode + ' ' + v.attr).toLowerCase().includes(q));
      if (!base.includes(q) && !inVariants) return false;
    }
    return true;
  }, [sets, status, q]);

  const list = useMemo(() => (products || []).filter((p) => match(p)), [products, match]);

  // comptage dynamique : pour chaque facette, on compte sur les produits filtrés par TOUTES les autres.
  const facetCounts = (key: FKey): Record<string, number> => {
    const m: Record<string, number> = {};
    (products || []).forEach((p) => { if (match(p, key)) { const k = String(p[key] as any); if (k) m[k] = (m[k] || 0) + 1; } });
    return m;
  };

  const effVariants = (p: Product): Variant[] => p.variants.length ? p.variants : [{
    id: p.id, sku: p.code || '—', attr: 'variante unique', color: '#ccd1d8', state: p.productState, b2b: p.b2b === 'Oui',
    availQty: 0, nextSupplyQty: 0, nextSupplyDate: '', supplier: p.supplier, externalId: '', createdOn: '', barcode: p.barcode, price: p.price,
    cost: p.cost, weight: p.weight, volume: p.volume, dimVariant: p.dim, hsVariant: p.hs, origin: p.origin,
    diameter: '', dimPacked: '', flatpack: '', spidy: '', pricePublic: null, priceWholesale: null, priceUsd: null,
  }];

  const applyWrite = (updated: Product) => {
    setProducts((products || []).map((p) => (p.id === updated.id ? updated : p)));
    setSel((s) => (s ? { ...s, product: updated } : s));
  };

  // sélection multiple de variantes (pour impression groupée d'étiquettes)
  const vkey = (pid: number, i: number) => `${pid}::${i}`;
  const toggleVar = (k: string) => setSelVar((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setVars = (pid: number, indices: number[], on: boolean) => setSelVar((s) => {
    const n = new Set(s); indices.forEach((i) => { const k = vkey(pid, i); on ? n.add(k) : n.delete(k); }); return n;
  });
  // filtres au niveau variante (B2B, statut) -> masquent les sous-lignes qui ne correspondent pas
  const variantMatch = (v: Variant) => {
    if (sets.productState.size && !sets.productState.has(v.state)) return false;
    if (sets.b2b.size && !sets.b2b.has(v.b2b ? 'Oui' : 'Non')) return false;
    return true;
  };
  const selectedItems = (): { product: Product; variant: Variant }[] => {
    const items: { product: Product; variant: Variant }[] = [];
    (products || []).forEach((p) => effVariants(p).forEach((v, i) => { if (selVar.has(vkey(p.id, i))) items.push({ product: p, variant: v }); }));
    return items;
  };

  // inclure/exclure les variantes sélectionnées du catalogue B2B (x_studio_saleable_in_wholesale)
  const setB2bBulk = async (value: boolean) => {
    const ids = Array.from(new Set(selectedItems().map((x) => x.variant.id).filter(Boolean)));
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await writeManyOdoo({ model: 'product.product', ids, values: { x_studio_saleable_in_wholesale: value } });
      const idSet = new Set(ids);
      setProducts((products || []).map((p) => {
        let changed = false;
        const vs = p.variants.map((v) => (idSet.has(v.id) ? ((changed = true), { ...v, b2b: value }) : v));
        if (!changed) return p;
        return { ...p, variants: vs, b2b: vs.some((v) => v.b2b) ? 'Oui' : 'Non' };
      }));
      setToast({ msg: `✓ ${ids.length} variante(s) ${value ? 'incluses dans' : 'exclues des'} masterdata B2B` });
      setSelVar(new Set());
    } catch (e) {
      setToast({ msg: '✗ Échec écriture : ' + (e instanceof Error ? e.message : String(e)), err: true });
    } finally { setBulkBusy(false); }
  };

  // export Excel des variantes sélectionnées au format Odoo « Product (product.product) »
  const exportSelected = async () => {
    const ids = Array.from(new Set(selectedItems().map((x) => x.variant.id).filter(Boolean)));
    if (!ids.length) return;
    setExporting(true);
    try {
      const { filename, b64 } = await fetchExport(ids);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      URL.revokeObjectURL(a.href);
      setToast({ msg: `✓ Export de ${ids.length} variante(s)` });
    } catch (e) {
      setToast({ msg: '✗ Export échoué : ' + (e instanceof Error ? e.message : String(e)), err: true });
    } finally { setExporting(false); }
  };

  // codes HS existants (variantes) triés par fréquence, avec description -> aide à la saisie
  const hsOptions = useMemo(() => {
    const freq: Record<string, number> = {};
    (products || []).forEach((p) => p.variants.forEach((v) => { if (v.hsVariant) freq[v.hsVariant] = (freq[v.hsVariant] || 0) + 1; }));
    return Object.keys(freq).sort((a, b) => freq[b] - freq[a]).map((code) => {
      const d = hsDescription(code); return { value: code, label: d ? `${code} — ${d}` : code };
    });
  }, [products]);

  if (!products) return <div className="loading">Chargement des produits depuis Odoo…</div>;

  // vue à plat : une ligne par variante visible (template en colonne), triée par template
  const flatRows = list.flatMap((p) => effVariants(p).map((v, i) => ({ p, v, i })).filter((x) => variantMatch(x.v)));
  const variantCount = flatRows.length;
  const allKeys = flatRows.map((r) => vkey(r.p.id, r.i));
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selVar.has(k));

  // tri par colonne (alpha ou numérique)
  const SORTCOLS: Record<string, { get: (r: { p: Product; v: Variant }) => any; num?: boolean }> = {
    template: { get: (r) => r.p.name }, ref: { get: (r) => r.v.sku }, variante: { get: (r) => r.v.attr },
    superCat: { get: (r) => r.p.superCat }, collection: { get: (r) => r.p.collection }, subcol: { get: (r) => r.p.subcol },
    cat: { get: (r) => r.p.cat }, sub: { get: (r) => r.p.sub }, type: { get: (r) => r.p.tiptoeType },
    state: { get: (r) => r.v.state }, dim: { get: (r) => r.v.dimVariant }, created: { get: (r) => r.v.createdOn },
    ht: { get: (r) => pubPrice(r.v), num: true }, ttc: { get: (r) => pubPrice(r.v) * 1.2, num: true },
    active: { get: (r) => (r.p.active ? 1 : 0), num: true }, sale: { get: (r) => (r.p.saleOk ? 1 : 0), num: true }, buy: { get: (r) => (r.p.buyOk ? 1 : 0), num: true },
  };
  const sc = SORTCOLS[sort.col] || SORTCOLS.template;
  const sortedRows = [...flatRows].sort((a, b) => {
    const av = sc.get(a), bv = sc.get(b);
    if (sc.num) return ((av || 0) - (bv || 0)) * sort.dir;
    return String(av || '').localeCompare(String(bv || ''), 'fr', { numeric: true }) * sort.dir;
  });
  const sortBy = (col: string) => setSort((s) => ({ col, dir: s.col === col ? (s.dir === 1 ? -1 : 1) : 1 }));
  const arrow = (col: string) => (sort.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

  const renderFacet = (key: FKey, label: string, scroll?: boolean, isState?: boolean, order?: string[]) => {
    const counts = facetCounts(key);
    let keys = Object.keys(counts);
    if (order) keys = order.filter((k) => counts[k]);
    else if (isState) keys = STATES.map((s) => s[0]).filter((k) => counts[k]);
    else keys = keys.sort();
    const opts = keys.map((k) => (
      <label className={'fopt' + (sets[key].has(k) ? ' sel' : '')} key={k}>
        <input type="checkbox" checked={sets[key].has(k)} onChange={() => toggle(key, k)} />
        <span>{isState ? stateLabel(k) : (key === 'supplier' ? k : cap(k))}</span><span className="c">{counts[k]}</span>
      </label>
    ));
    return (
      <div className="fblock" key={key}>
        <div className="rh">{label} {sets[key].size > 0 && <span className="clr" onClick={() => clear(key)}>effacer</span>}</div>
        {scroll ? <div className="scrollbox">{opts}</div> : opts}
      </div>
    );
  };

  const activeCount = FACETS.reduce((n, f) => n + sets[f.key].size, 0);

  return (
    <div className="layout">
      <FilterRail activeCount={activeCount}>
        {FACETS.map((f) => renderFacet(f.key, f.label, f.scroll, f.state, f.order))}
        <div className="fblock">
          <div className="rh">Statut</div>
          <div className="seg">
            {[['active', 'Actifs'], ['archived', 'Archivés'], ['sale', 'Vendables'], ['purchase', 'Achetables']].map(([k, l]) => (
              <span key={k} className={'segb' + (status === k ? ' on' : '')} onClick={() => setStatus(k)}>{l}</span>
            ))}
          </div>
        </div>
      </FilterRail>

      <main className="main">
        <div className="mhead">
          <h1>Produits</h1>
          <span className="count">
            <b>{list.length}</b> template{list.length > 1 ? 's' : ''} · <b>{variantCount}</b> variante{variantCount > 1 ? 's' : ''}
            {selVar.size > 0 && <> · <b style={{ color: 'var(--accent)' }}>{selVar.size} sélectionnée{selVar.size > 1 ? 's' : ''}</b></>}
          </span>
          <div className="actions">
            {selVar.size > 0 && (
              <div className="actions-menu">
                <button className="btn primary" onClick={() => setActionsOpen((o) => !o)}>
                  ⚙ {selVar.size} sélectionnée{selVar.size > 1 ? 's' : ''} ▾</button>
                {actionsOpen && <>
                  <div className="menu-catcher" onClick={() => setActionsOpen(false)}></div>
                  <div className="menu-pop">
                    <button className="menu-it" onClick={() => { setActionsOpen(false); exportLabelsPdf(selectedItems()); }}>🏷️ Imprimer les étiquettes</button>
                    <button className="menu-it" disabled={exporting} onClick={() => { setActionsOpen(false); exportSelected(); }}>{exporting ? '… Export en cours' : '⤓ Exporter (Excel — format Odoo)'}</button>
                    {isAdmin && <>
                      <div className="menu-sep"></div>
                      <button className="menu-it" disabled={bulkBusy} onClick={() => { setActionsOpen(false); setB2bBulk(true); }}>＋ Inclure dans les masterdata B2B</button>
                      <button className="menu-it" disabled={bulkBusy} onClick={() => { setActionsOpen(false); setB2bBulk(false); }}>－ Exclure des masterdata B2B</button>
                    </>}
                    <div className="menu-sep"></div>
                    <button className="menu-it" onClick={() => { setActionsOpen(false); setSelVar(new Set()); }}>Désélectionner</button>
                  </div>
                </>}
              </div>
            )}
          </div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th className="chk"><input type="checkbox" checked={allSelected} onChange={(e) => setSelVar(e.target.checked ? new Set(allKeys) : new Set())} /></th>
              <th className="sortable" onClick={() => sortBy('template')}>Template{arrow('template')}</th>
              <th className="sortable" onClick={() => sortBy('ref')}>Référence{arrow('ref')}</th>
              <th className="sortable" onClick={() => sortBy('variante')}>Variante{arrow('variante')}</th>
              <th className="sortable" onClick={() => sortBy('superCat')}>Super-cat.{arrow('superCat')}</th>
              <th className="sortable" onClick={() => sortBy('collection')}>Collection{arrow('collection')}</th>
              <th className="sortable" onClick={() => sortBy('subcol')}>Sous-collection{arrow('subcol')}</th>
              <th className="sortable" onClick={() => sortBy('cat')}>Catégorie{arrow('cat')}</th>
              <th className="sortable" onClick={() => sortBy('sub')}>Sous-catégorie{arrow('sub')}</th>
              <th className="sortable" onClick={() => sortBy('type')}>TipToe type{arrow('type')}</th>
              <th className="sortable" onClick={() => sortBy('state')}>État{arrow('state')}</th>
              <th className="sortable" onClick={() => sortBy('dim')}>Dimensions{arrow('dim')}</th>
              <th className="sortable" onClick={() => sortBy('created')}>Créé le{arrow('created')}</th>
              <th className="r sortable" onClick={() => sortBy('ht')}>Prix HT{arrow('ht')}</th>
              <th className="r sortable" onClick={() => sortBy('ttc')}>Prix TTC{arrow('ttc')}</th>
              <th className="c sortable" onClick={() => sortBy('active')}>Actif{arrow('active')}</th>
              <th className="c sortable" onClick={() => sortBy('sale')}>Vendable{arrow('sale')}</th>
              <th className="c sortable" onClick={() => sortBy('buy')}>Achetable{arrow('buy')}</th>
            </tr></thead>
            <tbody>
              {sortedRows.map(({ p, v, i }) => {
                const k = vkey(p.id, i);
                return (
                  <tr key={k} className="frow" onClick={() => setSel({ product: p, variantId: v.id })}>
                    <td className="chk" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selVar.has(k)} onChange={() => toggleVar(k)} /></td>
                    <td><div className="pcell">
                      {p.image ? <img className="thumb" src={p.image} alt="" /> : <span className="thumb ph">◆</span>}
                      <div><div className="pname">{p.name}</div>{p.code && <div className="psub">{p.code}</div>}</div>
                    </div></td>
                    <td className="code">{v.sku}</td>
                    <td><span className="swatch" style={swatchStyle(v.attr, v.color)}></span>{v.attr}</td>
                    <td className="hcol">{p.superCat ? cap(p.superCat) : '—'}</td>
                    <td className="hcol">{p.collection ? cap(p.collection) : '—'}</td>
                    <td className="hcol">{p.subcol ? cap(p.subcol) : '—'}</td>
                    <td className="hcol">{p.cat ? cap(p.cat) : '—'}</td>
                    <td className="hcol">{p.sub ? cap(p.sub) : '—'}</td>
                    <td>{p.tiptoeType ? <span className="tt" style={ttStyle(p.tiptoeType)}>{p.tiptoeType}</span> : <span className="cap">—</span>}</td>
                    <td>{v.state ? <span className={'stbadge s-' + v.state}>{stateLabel(v.state)}</span> : '—'}</td>
                    <td className="dim">{v.dimVariant || '—'}</td>
                    <td className="hcol">{v.createdOn || '—'}</td>
                    <td className="r price">{money(pubPrice(v))}</td>
                    <td className="r price ttc">{money(pubPrice(v) * 1.2)}</td>
                    <td className="c">{flag(p.active)}</td>
                    <td className="c">{flag(p.saleOk)}</td>
                    <td className="c">{flag(p.buyOk)}</td>
                  </tr>
                );
              })}
              {!sortedRows.length && <tr><td colSpan={18} style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>Aucun produit.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {sel && <Drawer product={sel.product} initialVariantId={sel.variantId} onClose={() => setSel(null)} onWrite={applyWrite} hsOptions={hsOptions} isAdmin={isAdmin} />}
      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
};

// ============================== Drawer ==============================
const TABS: [string, string][] = [
  ['general', 'Général'], ['hierarchy', 'Hiérarchie'], ['logistics', 'Logistique & Dimensions'],
  ['custom', 'Champs custom'], ['variants', 'Variantes'], ['translations', 'Traductions'], ['bom', 'Nomenclature'],
];
const SUPERS = ['sofa', 'accessory', 'chair_and_stool', 'various', 'shelf', 'lamp', 'professional_furniture', 'table_leg', 'storage', 'table_and_desk'];

const Drawer: React.FC<{ product: Product; initialVariantId?: number | null; onClose: () => void; onWrite: (p: Product) => void; hsOptions: { value: string; label: string }[]; isAdmin: boolean }> = ({ product, initialVariantId, onClose, onWrite, hsOptions, isAdmin }) => {
  const [tab, setTab] = useState('general');
  const [variantIdx, setVariantIdx] = useState<number | null>(() => {
    if (initialVariantId == null) return null;
    const idx = product.variants.findIndex((x) => x.id === initialVariantId);
    return idx >= 0 ? idx : null;
  });
  const [edits, setEdits] = useState<Edits>({});
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const variants = product.variants.length ? product.variants : [];
  const variant = variantIdx != null ? variants[variantIdx] : null;
  const target: any = variant || product;

  const reset = useCallback(() => setEdits({}), []);
  const openVariant = (i: number) => { setVariantIdx(i); setEdits({}); };
  const backToTemplate = () => { setVariantIdx(null); setEdits({}); setTab('variants'); };

  const setField = (key: string, orig: any, val: string | boolean) => {
    setEdits((e) => {
      const n = { ...e };
      if (String(val) === String(orig)) delete n[key]; else n[key] = val;
      return n;
    });
  };
  const dirtyCount = Object.keys(edits).length;

  const save = async () => {
    const map = variant ? VAR_MAP : TMPL_MAP;
    const model = variant ? 'product.product' : 'product.template';
    const values: Record<string, any> = {};
    Object.keys(edits).forEach((k) => {
      if (!(k in map)) return;
      let v: any = edits[k];
      if (NUMERIC.has(k)) v = Number(v);
      values[map[k]] = v;
    });
    if (!Object.keys(values).length) { setToast({ msg: 'Aucun champ mappé à écrire' }); return; }
    setSaving(true);
    try {
      await writeOdoo({ model: model as any, id: target.id, values });
      // maj locale
      const upd: Product = { ...product, variants: product.variants.map((x) => ({ ...x })) };
      const tgt: any = variant ? upd.variants[variantIdx!] : upd;
      Object.keys(edits).forEach((k) => { tgt[k] = NUMERIC.has(k) ? Number(edits[k]) : edits[k]; });
      onWrite(upd);
      setEdits({});
      setToast({ msg: `✓ Écrit dans Odoo (TEST) — ${model} · ${Object.keys(values).length} champ(s)` });
    } catch (e) {
      setToast({ msg: '✗ Échec écriture : ' + (e instanceof Error ? e.message : String(e)), err: true });
    } finally { setSaving(false); }
  };

  const cur = (key: string, orig: any) => (key in edits ? edits[key] : orig);
  const isDirty = (key: string, orig: any) => key in edits && String(edits[key]) !== String(orig);

  const fld = (label: string, key: string, orig: any, opts: { full?: boolean; ro?: boolean; hint?: string; select?: string[]; list?: { value: string; label: string }[] } = {}) => {
    if (!isAdmin) opts = { ...opts, ro: true };   // non-admin = lecture seule
    const val = cur(key, orig ?? '');
    const dc = !opts.ro && isDirty(key, orig ?? '') ? ' dirty' : '';
    const lab = <label>{label}{opts.hint && <span className="fhint">{opts.hint}</span>}</label>;
    const dlId = 'dl-' + key;
    return (
      <div className={'field' + (opts.full ? ' full' : '')} key={key}>
        {lab}
        {opts.select
          ? <select className={'in' + dc} value={String(val)} disabled={opts.ro} onChange={(e) => setField(key, orig ?? '', e.target.value)}>
              {opts.select.map((o) => <option key={o}>{o}</option>)}</select>
          : <>
              <input className={'in' + dc} value={String(val ?? '')} readOnly={opts.ro} list={opts.list ? dlId : undefined}
                onChange={(e) => setField(key, orig ?? '', e.target.value)} />
              {opts.list && <datalist id={dlId}>{opts.list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>}
            </>}
      </div>
    );
  };
  const tog = (label: string, key: string, orig: boolean) => {
    const on = cur(key, orig) === true || cur(key, orig) === 'true';
    return <div className="toggle" key={key}><div className={'switch' + (on ? ' on' : '') + (isAdmin ? '' : ' locked')} onClick={() => { if (isAdmin) setField(key, orig, !on); }}></div><span>{label}</span></div>;
  };

  return (
    <>
      <div className="scrim show" onClick={onClose}></div>
      <aside className="drawer show">
        {variant ? (
          <div className="dh">
            {product.image ? <img className="thumb lg" src={product.image} alt="" /> : <span className="thumb lg ph">◆</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <button className="back" onClick={backToTemplate}>‹ Retour au template</button>
              <div className="dt" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{product.name}</span>
                <span style={{ color: 'var(--faint)', fontWeight: 400 }}>›</span>
                <span className="swatch" style={{ ...swatchStyle(variant.attr, variant.color), width: 16, height: 16 }}></span>
                <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{variant.attr}</span>
              </div>
              <div className="dcode">{variant.sku} · product.product</div>
            </div><button className="x" onClick={onClose}>✕</button></div>
        ) : (
          <div className="dh">
            {product.image ? <img className="thumb lg" src={product.image} alt="" /> : <span className="thumb lg ph">◆</span>}
            <div>
              <div className="dt">{product.name}</div>
              <div className="dcode">{product.code || '—'} · product.template #{product.id}</div>
            </div><button className="x" onClick={onClose}>✕</button></div>
        )}

        {variant
          ? <VariantBody variant={variant} fld={fld} tog={tog} product={product} hsOptions={hsOptions} />
          : (
            <>
              <div className="dtabs">{TABS.map(([k, l]) => (
                <span key={k} className={'dtab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</span>))}</div>
              <div className="dbody">
                <TemplateBody product={product} tab={tab} fld={fld} tog={tog} openVariant={openVariant} />
              </div>
            </>
          )}

        <div className="dfoot">
          {isAdmin ? <>
            <span className="status">{dirtyCount ? <><b>{dirtyCount} champ{dirtyCount > 1 ? 's' : ''} modifié{dirtyCount > 1 ? 's' : ''}</b> · prêt</> : 'Aucune modification'}</span>
            <span className="model-tag">→ {variant ? 'product.product' : 'product.template'}</span>
            <span className="spacer"></span>
            <button className="btn-ghost" disabled={!dirtyCount || saving} onClick={reset}>Annuler</button>
            <button className="btn-write" disabled={!dirtyCount || saving} onClick={save}>{saving ? 'Écriture…' : '⬆ Écrire dans Odoo'}</button>
          </> : <span className="status">🔒 Lecture seule — modification réservée aux administrateurs</span>}
        </div>
      </aside>
      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
    </>
  );
};

const Toast: React.FC<{ toast: { msg: string; err?: boolean }; onDone: () => void }> = ({ toast, onDone }) => {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [toast, onDone]);
  return <div className={'toast show' + (toast.err ? ' err' : '')}>{toast.msg}</div>;
};

// ---- template tabs body ----
const TemplateBody: React.FC<any> = ({ product: p, tab, fld, tog, openVariant }) => {
  if (tab === 'general') return (
    <>
      <div className="grp2">
        {fld('Nom (FR)', 'name', p.name, { full: true })}
        {fld('Référence interne', 'code', p.code, { hint: 'default_code' })}
        {fld('TipToe Ref', 'tiptoeRef', p.tiptoeRef, { hint: 'x_studio_tiptoe_ref' })}
        {fld('Prix de vente (€)', 'price', p.price, { hint: 'list_price' })}
        {fld('Coût (€)', 'cost', p.cost, { hint: 'standard_price' })}
        {fld('TipToe Type', 'tiptoeType', p.tiptoeType, { hint: 'x_studio_tiptoe_type' })}
        {fld('TipToe Type (détail)', 'tiptoeTypeDetail', p.tiptoeTypeDetail, { hint: 'x_studio_tiptoe_type_detail', ro: true })}
        {fld('Date de lancement', 'launch', p.launch, { hint: 'x_studio_launch_date' })}
      </div>
      <div className="sectitle" style={{ marginTop: 18 }}>Disponibilité</div>
      {tog('Peut être vendu (sale_ok)', 'saleOk', p.saleOk)}
      {tog('Peut être acheté (purchase_ok)', 'buyOk', p.buyOk)}
      {tog('Actif (non archivé)', 'active', p.active)}
    </>
  );
  if (tab === 'hierarchy') return (
    <div className="grp2">
      {fld('Super-catégorie', 'superCat', p.superCat, { select: SUPERS, hint: 'x_super_category' })}
      {fld('Collection', 'collection', p.collection, { hint: 'x_collection' })}
      {fld('Catégorie', 'cat', p.cat, { hint: 'x_category' })}
      {fld('Sous-catégorie', 'sub', p.sub, { hint: 'x_sub_category' })}
      {fld('Sous-collection', 'subcol', p.subcol, { hint: 'x_sub_collection' })}
      {fld('Catégorie Odoo', 'odooCat', p.odooCat, { ro: true, hint: 'categ_id' })}
    </div>
  );
  if (tab === 'logistics') return (
    <div className="grp2">
      {fld('Dimensions', 'dim', p.dim, { full: true, hint: 'x_studio_dimensions' })}
      {fld('Poids (kg)', 'weight', p.weight, { hint: 'weight' })}
      {fld('Volume (m³)', 'volume', p.volume, { hint: 'volume' })}
      {fld('Code-barres', 'barcode', p.barcode, { hint: 'barcode' })}
      {fld('Code HS', 'hs', p.hs, { hint: 'hs_code' })}
      {fld('Origine', 'origin', p.origin, { ro: true, hint: 'country_of_origin' })}
      {fld('Coût transport (€)', 'transport', p.transport, { hint: 'x_studio_transport_cost' })}
    </div>
  );
  if (tab === 'custom') return (
    <>
      <div className="sectitle">Champs personnalisés (x_studio_*)</div>
      <div className="grp2">
        {fld('x_studio_tiptoe_ref', 'tiptoeRef', p.tiptoeRef)}
        {fld('x_studio_dimensions', 'dim', p.dim)}
        {fld('x_studio_launch_date', 'launch', p.launch)}
        {fld('x_studio_transport_cost', 'transport', p.transport)}
        {fld('x_studio_tiptoe_type', 'tiptoeType', p.tiptoeType)}
        {fld('x_studio_woo_tmpl_id', 'woo', p.woo, { ro: true })}
      </div>
    </>
  );
  if (tab === 'variants') {
    const vs: Variant[] = p.variants.length ? p.variants : [];
    return (
      <>
        <div className="sectitle">{vs.length || 1} variante{vs.length > 1 ? 's' : ''} — cliquez pour le détail product.product</div>
        <table className="vtable"><thead><tr><th>Attribut</th><th>Référence</th><th>Code-barres</th><th className="r">Prix</th><th></th></tr></thead>
          <tbody>{(vs.length ? vs : [{ sku: p.code, attr: 'variante unique', color: '#ccd1d8', barcode: p.barcode, price: p.price } as any]).map((v: Variant, i: number) => (
            <tr key={i} style={{ cursor: vs.length ? 'pointer' : 'default' }} onClick={() => vs.length && openVariant(i)}>
              <td><span className="swatch" style={swatchStyle(v.attr, v.color)}></span>{v.attr}</td>
              <td className="code">{v.sku}</td><td className="code">{v.barcode || '—'}</td>
              <td className="r price">{money(pubPrice(v))}</td>
              <td className="r vopen">{vs.length ? 'détail ›' : ''}</td>
            </tr>))}</tbody></table>
      </>
    );
  }
  if (tab === 'translations') return <Translations tmplId={p.id} fallback={p} />;
  if (tab === 'bom') return <BomTab tmplId={p.id} />;
  return null;
};

// ---- variant body: fields + pricing ----
const VariantBody: React.FC<{ variant: Variant; fld: any; tog: any; product: Product; hsOptions: { value: string; label: string }[] }> = ({ variant: v, fld, tog, product, hsOptions }) => {
  const [vtab, setVtab] = useState<'fields' | 'pricing' | 'diffusion' | 'stock' | 'label'>('fields');
  const base = v.pricePublic;                                  // marge calculée sur le public HT
  const marginAbs = base != null ? base - v.cost : null;
  const marginPct = base ? Math.round((marginAbs! / base) * 1000) / 10 : null;
  return (
    <>
      <div className="dtabs">
        <span className={'dtab' + (vtab === 'fields' ? ' on' : '')} onClick={() => setVtab('fields')}>Champs</span>
        <span className={'dtab' + (vtab === 'pricing' ? ' on' : '')} onClick={() => setVtab('pricing')}>Pricing</span>
        <span className={'dtab' + (vtab === 'diffusion' ? ' on' : '')} onClick={() => setVtab('diffusion')}>Diffusion</span>
        <span className={'dtab' + (vtab === 'stock' ? ' on' : '')} onClick={() => setVtab('stock')}>Stock</span>
        <span className={'dtab' + (vtab === 'label' ? ' on' : '')} onClick={() => setVtab('label')}>Étiquette</span>
      </div>
      <div className="dbody">
        {vtab === 'fields' ? (
          <>
            <div className="sectitle">Champs propres à la variante (product.product)</div>
            <div className="grp2">
              {fld('Référence interne', 'sku', v.sku, { hint: 'default_code' })}
              {fld('Code-barres (EAN)', 'barcode', v.barcode, { hint: 'barcode' })}
              {fld('Coût (€)', 'cost', v.cost, { hint: 'standard_price' })}
              {fld('Prix de vente (€)', 'price', pubPrice(v), { hint: 'Public Pricelist HT', ro: true })}
              {fld('Poids (kg)', 'weight', v.weight, { hint: 'weight' })}
              {fld('Volume (m³)', 'volume', v.volume, { hint: 'volume' })}
              {fld('Dimensions (variante)', 'dimVariant', v.dimVariant, { full: true, hint: 'x_studio_dimensions_variant' })}
              {fld('Dimensions emballé', 'dimPacked', v.dimPacked, { hint: 'x_studio_dimensions_packed' })}
              {fld('Diamètre', 'diameter', v.diameter, { hint: 'x_studio_diameter' })}
              {fld('Code HS (variante)', 'hsVariant', v.hsVariant, { hint: 'x_studio_hs_code_variant', list: hsOptions })}
              {fld('Origine (variante)', 'origin', v.origin, { ro: true, hint: 'x_studio_country_of_origin_variant' })}
              {fld('Flatpack', 'flatpack', v.flatpack, { select: ['', 'yes', 'no'], hint: 'x_studio_flatpack' })}
              {fld('Gamme / Famille Spidy', 'spidy', v.spidy, { hint: 'x_studio_gamme_famille_spidy' })}
              {fld('Fournisseur par défaut', 'supplier', v.supplier, { hint: 'x_studio_char_field_6T0cm' })}
              {fld('External ID (Odoo)', 'externalId', v.externalId, { hint: 'ir.model.data', ro: true })}
            </div>
            <div className="sectitle" style={{ marginTop: 18 }}>Code-barres</div>
            <div className="bcbox"><Barcode value={v.barcode} /></div>
          </>
        ) : vtab === 'pricing' ? (
          <>
            <div className="sectitle">Prix par liste — {v.sku} (product.pricelist.item)</div>
            <table className="ptable"><thead><tr><th>Liste de prix</th><th>Devise</th><th className="r">Prix</th><th>Règle</th></tr></thead>
              <tbody>
                <tr><td>Prix de vente <span className="fhint">list_price</span></td><td>EUR</td><td className="r price">{money(v.price)}</td><td><span className="rbadge tmpl">champ variante</span></td></tr>
                <tr><td>Public Pricelist HT</td><td>EUR</td><td className="r price">{money(v.pricePublic)}</td><td><span className="rbadge fix">item fixe</span></td></tr>
                <tr><td>Wholesale</td><td>EUR</td><td className="r price">{money(v.priceWholesale)}</td><td><span className="rbadge inh">−43% (global)</span></td></tr>
                <tr><td>USD</td><td>$ USD</td><td className="r price">{money(v.priceUsd, '$')}</td><td><span className="rbadge fix">item fixe</span></td></tr>
                <tr style={{ borderTop: '2px solid var(--line)' }}><td>Coût de revient <span className="fhint">standard_price</span></td><td>EUR</td><td className="r price">{money(v.cost)}</td><td><span className="rbadge tmpl">variante</span></td></tr>
                <tr><td><b>Marge brute</b> <span className="cap">/ public HT</span></td><td>EUR</td>
                  <td className="r price" style={{ color: marginAbs != null && marginAbs < 0 ? 'var(--red)' : 'var(--write)' }}>{money(marginAbs)}</td>
                  <td>{marginPct != null ? <span className={'rbadge ' + (marginPct >= 0 ? 'fix' : 'inh')}>{marginPct}%</span> : '—'}</td></tr>
              </tbody></table>
            <div className="cap" style={{ paddingTop: 12 }}>Marge brute = (public HT − coût de revient) / public HT. Prix public & USD = <code>product.pricelist.item</code> fixes ; wholesale hérite d'une règle globale −43%.</div>
          </>
        ) : vtab === 'diffusion' ? (
          <>
            <div className="sectitle">Diffusion</div>
            {tog('Disponible en B2B / wholesale', 'b2b', v.b2b)}
            <div className="cap" style={{ paddingTop: 8 }}>Contrôle l'apparition de la variante dans le catalogue B2B. Écrit sur <code>x_studio_saleable_in_wholesale</code> (product.product).</div>
          </>
        ) : vtab === 'stock' ? (
          <>
            <div className="sectitle">Stock (product.product)</div>
            <div className="grp2">
              {fld('Qté disponible 2.0', 'availQty', v.availQty, { hint: 'x_available_qty', ro: true })}
              {fld('Qté prochaine appro 2.0', 'nextSupplyQty', v.nextSupplyQty, { hint: 'x_next_supply_qty', ro: true })}
              {fld('Prochaine appro 2.0', 'nextSupplyDate', v.nextSupplyDate, { hint: 'x_next_supply_date', ro: true })}
            </div>
            <div className="cap" style={{ paddingTop: 8 }}>Informations de l'onglet Stock d'Odoo (lecture seule).</div>
          </>
        ) : (
          <ProductLabel product={product} variant={v} />
        )}
      </div>
    </>
  );
};

const labelNames = (product: Product, v: Variant) => {
  const suffix = v.attr && v.attr !== 'variante unique' ? ` — ${v.attr}` : '';
  return { fr: product.name + suffix, en: (product.nameEn || product.name) + suffix };
};
const withMm = (d: string) => (d && !/mm\s*$/i.test(d) ? d + 'mm' : d);
// "1700x386x450mm" -> "1700 × 386 × 450 mm" (espacé, mm ajouté si absent)
const formatDims = (d: string) => {
  if (!d) return '';
  let s = withMm(d.trim());
  s = s.replace(/\s*[x×*]\s*/gi, ' × ').replace(/\s*mm\s*$/i, ' mm');
  return s.replace(/\s+/g, ' ').trim();
};
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const svgToPng = (url: string, vbW: number, vbH: number, scale: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = vbW * scale; c.height = vbH * scale;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });

// Charge une image (jpg/png) en dataURL carré.
const imgToPng = (url: string, size: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d'); if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, size, size); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject; img.src = url;
  });

// Dessine une étiquette 6×5 cm sur la page courante (vectoriel : texte + rect ; logo, EAN & matière en image).
function drawLabel(doc: jsPDF, logo: string | null, matMap: Record<string, string>, product: Product, v: Variant) {
  if (logo) { const lw = 40, lh = (lw * 192.45) / 904.14; doc.addImage(logo, 'PNG', (60 - lw) / 2, 4.5, lw, lh); }
  doc.setFont('courier','bold'); doc.setFontSize(12);
  doc.text(v.sku || '', 30, 17, { align: 'center' });
  const { fr, en } = labelNames(product, v);
  doc.setFont('courier','normal'); doc.setFontSize(6.2);
  let y = 22.5;
  const frLines = doc.splitTextToSize(fr, 40);
  doc.text(frLines, 3, y); y += frLines.length * 2.5 + 1.5;
  doc.setDrawColor(20); doc.setLineWidth(0.3); doc.line(8, y, 39, y); y += 3;
  doc.text(doc.splitTextToSize(en, 40), 3, y);
  const mat = materialFor(v.attr);
  const col = colorFor(v.attr);
  const sq = (yy: number, size: number, hex?: string, img?: string) => {
    const x = 57 - size;
    if (img && matMap[img]) doc.addImage(matMap[img], 'JPEG', x, yy, size, size);
    else { const [r, g, b] = hexToRgb(hex || '#e2e5e9'); doc.setFillColor(r, g, b); doc.rect(x, yy, size, size, 'F'); }
  };
  if (mat && col) { sq(19, 8.5, undefined, mat.img); sq(28.5, 8.5, col, undefined); }  // deux carrés descendus, plus petits
  else if (mat) { sq(19, 11, mat.color, mat.img); }
  else { sq(19, 11, col || v.color, undefined); }
  if (v.barcode) {
    try {
      const cv = document.createElement('canvas');
      JsBarcode(cv, v.barcode, { format: /^\d{13}$/.test(v.barcode) ? 'EAN13' : 'CODE128', width: 4, height: 90, fontSize: 26, margin: 0 });
      doc.addImage(cv.toDataURL('image/png'), 'PNG', 3, 38, 27, 10);
    } catch { /* EAN invalide */ }
  }
  const dims = v.dimPacked || v.dimVariant || product.dim || '';
  doc.setFont('courier','bold'); doc.setFontSize(9);
  if (v.weight) doc.text(`${v.weight} kg`, 57, 42.5, { align: 'right' });
  doc.setFont('courier','normal'); doc.setFontSize(5.4);
  if (dims) doc.text(formatDims(dims), 57, 46.5, { align: 'right' });
}

async function loadLogo(): Promise<string | null> {
  try { return await svgToPng(process.env.PUBLIC_URL + '/tiptoe-logo.svg', 904.14, 192.45, 4); } catch { return null; }
}

// Génère un PDF (une page 6×5 cm par variante) pour 1..N articles.
async function exportLabelsPdf(items: { product: Product; variant: Variant }[]) {
  if (!items.length) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [60, 50] });
  const logo = await loadLogo();
  const urls = Array.from(new Set(items.map((it) => materialFor(it.variant.attr)?.img).filter(Boolean) as string[]));
  const matMap: Record<string, string> = {};
  await Promise.all(urls.map(async (u) => { try { matMap[u] = await imgToPng(u, 240); } catch { /* skip */ } }));
  items.forEach((it, i) => { if (i > 0) doc.addPage([60, 50], 'landscape'); drawLabel(doc, logo, matMap, it.product, it.variant); });
  doc.save(items.length === 1 ? `${items[0].variant.sku || 'etiquette'}.pdf` : `etiquettes-${items.length}.pdf`);
}

// Reconstruction de l'étiquette produit TIPTOE au format 5×5 cm.
const ProductLabel: React.FC<{ product: Product; variant: Variant }> = ({ product, variant: v }) => {
  const dims = v.dimPacked || v.dimVariant || product.dim || '';
  const { fr, en } = labelNames(product, v);
  const mat = materialFor(v.attr);
  const col = colorFor(v.attr);
  return (
    <>
      <div className="sectitle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Étiquette · 6 × 5 cm</span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => exportLabelsPdf([{ product, variant: v }])}>⬇ Télécharger PDF</button>
      </div>
      <div className="label-sheet">
        <img className="label-logo-img" src={process.env.PUBLIC_URL + '/tiptoe-logo.svg'} alt="TIPTOE" />
        <div className="label-sku">{v.sku}</div>
        <div className="label-mid">
          <div className="label-names">
            <div className="label-fr">{fr}</div>
            <div className="label-div"></div>
            <div className="label-en">{en}</div>
          </div>
          <div className={'label-sw-col' + (mat && col ? ' two' : '')}>
            {mat && <div className="label-swatch" style={{ backgroundImage: `url("${mat.img}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} title="Matière"></div>}
            {col && <div className="label-swatch" style={{ background: col }} title="Couleur"></div>}
            {!mat && !col && <div className="label-swatch" style={{ background: v.color || '#e2e5e9' }}></div>}
          </div>
        </div>
        <div className="label-bottom">
          <div className="label-bc">{v.barcode ? <Barcode value={v.barcode} /> : <span className="cap">pas d'EAN</span>}</div>
          <div className="label-meta">
            <div>{v.weight ? `${v.weight} kg` : ''}</div>
            <div className="label-dims">{formatDims(dims)}</div>
          </div>
        </div>
      </div>
      <div className="cap" style={{ paddingTop: 10 }}>Reconstruction à partir des champs Odoo. Le PDF est au format 5×5 cm.</div>
    </>
  );
};

// ---- translations (lazy) ----
const Translations: React.FC<{ tmplId: number; fallback: Product }> = ({ tmplId, fallback }) => {
  const [tr, setTr] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    httpsCallable(functions, 'odooTranslations')({ tmplId })
      .then((r) => setTr(r.data as any))
      .catch(() => setTr({ en_US: fallback.nameEn, fr_FR: fallback.name, de_DE: fallback.nameDe }));
  }, [tmplId, fallback]);
  if (!tr) return <div className="cap">Chargement des traductions…</div>;
  const row = (flag: string, code: string, val: string) => (
    <div className="lang"><span className="flag">{flag}</span><span className="langcode">{code}</span>
      <input className="in" style={{ flex: 1 }} defaultValue={val} readOnly /></div>
  );
  return (
    <>
      <div className="sectitle">Nom du produit par langue</div>
      {row('🇫🇷', 'fr_FR', tr.fr_FR)}{row('🇬🇧', 'en_US', tr.en_US)}{row('🇩🇪', 'de_DE', tr.de_DE)}
      <div className="cap" style={{ paddingTop: 6 }}>4 langues actives en base. Édition par langue (contexte lang) à venir.</div>
    </>
  );
};

// ---- BOM tab in drawer (per product) ----
const BomTab: React.FC<{ tmplId: number }> = ({ tmplId }) => {
  const [boms, setBoms] = useState<Bom[] | null>(null);
  useEffect(() => { fetchBoms(tmplId).then(setBoms); }, [tmplId]);
  if (!boms) return <div className="cap">Chargement des nomenclatures…</div>;
  if (!boms.length) return <div className="cap">Aucune nomenclature pour ce produit.</div>;
  return <>{boms.map((b) => <BomCard key={b.id} bom={b} defaultOpen />)}</>;
};

// ============================== BOM view (dédiée) : tableau plat + filtres ==============================
type BKey = 'superCat' | 'collection' | 'cat';
const BFACETS: { key: BKey; label: string; scroll?: boolean }[] = [
  { key: 'superCat', label: 'Super-catégorie' },
  { key: 'collection', label: 'Collection', scroll: true },
  { key: 'cat', label: 'Catégorie', scroll: true },
];
const emptyBSets = (): Record<BKey, Set<string>> => ({ superCat: new Set(), collection: new Set(), cat: new Set() });

const BomView: React.FC<{ q: string }> = ({ q }) => {
  const [boms, setBoms] = useState<Bom[] | null>(null);
  const [sets, setSets] = useState<Record<BKey, Set<string>>>(emptyBSets());
  useEffect(() => { fetchBoms().then(setBoms); }, []);

  const toggle = (key: BKey, v: string) => setSets((s) => { const n = { ...s, [key]: new Set(s[key]) }; n[key].has(v) ? n[key].delete(v) : n[key].add(v); return n; });
  const match = useCallback((b: Bom, except?: BKey) => {
    for (const { key } of BFACETS) { if (key === except) continue; if (sets[key].size && !sets[key].has(String(b[key]))) return false; }
    if (q) { const h = (b.parentCode + ' ' + b.productName + ' ' + b.code).toLowerCase(); if (!h.includes(q)) return false; }
    return true;
  }, [sets, q]);

  if (!boms) return <div className="loading">Chargement des nomenclatures depuis Odoo…</div>;
  const list = boms.filter((b) => match(b));
  const facetCounts = (key: BKey) => { const m: Record<string, number> = {}; boms.forEach((b) => { if (match(b, key)) { const k = String(b[key]); if (k) m[k] = (m[k] || 0) + 1; } }); return m; };
  const totalLines = list.reduce((n, b) => n + Math.max(b.lines.length, 1), 0);

  const activeCount = BFACETS.reduce((n, f) => n + sets[f.key].size, 0);

  return (
    <div className="layout">
      <FilterRail activeCount={activeCount}>
        {BFACETS.map(({ key, label, scroll }) => {
          const counts = facetCounts(key); const keys = Object.keys(counts).sort();
          const opts = keys.map((k) => (
            <label className={'fopt' + (sets[key].has(k) ? ' sel' : '')} key={k}>
              <input type="checkbox" checked={sets[key].has(k)} onChange={() => toggle(key, k)} />
              <span>{cap(k)}</span><span className="c">{counts[k]}</span></label>
          ));
          return (<div className="fblock" key={key}>
            <div className="rh">{label} {sets[key].size > 0 && <span className="clr" onClick={() => setSets((s) => ({ ...s, [key]: new Set() }))}>effacer</span>}</div>
            {scroll ? <div className="scrollbox">{opts}</div> : opts}
          </div>);
        })}
      </FilterRail>

      <main className="main">
        <div className="mhead"><h1>Nomenclatures</h1><span className="count">{list.length} BOM · {totalLines} lignes</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>SKU parent</th><th>Description parent</th><th>Composant</th><th>Description composant</th><th className="r">Quantité</th>
            </tr></thead>
            <tbody>
              {list.flatMap((b) => {
                const rows = b.lines.length ? b.lines : [null];
                return rows.map((l, i) => (
                  <tr key={b.id + '-' + i} style={{ cursor: 'default' }} className={i === 0 ? 'bomfirst' : ''}>
                    <td className="code">{i === 0 ? (b.parentCode || '—') : ''}</td>
                    <td>{i === 0 ? <><span className="pname" style={{ fontSize: 12.5 }}>{b.productName}</span>{b.type === 'phantom' && <span className="kit" style={{ marginLeft: 6 }}>Kit</span>}</> : ''}</td>
                    <td className="code">{l ? (l.code || '—') : <span className="cap">(vide)</span>}</td>
                    <td>{l ? l.name : ''}</td>
                    <td className="r">{l ? l.qty + (l.uom ? ' ' + l.uom : '') : ''}</td>
                  </tr>
                ));
              })}
              {!list.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>Aucune nomenclature.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

const BomCard: React.FC<{ bom: Bom; defaultOpen?: boolean }> = ({ bom, defaultOpen }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="bom">
      <div className="bomh" onClick={() => setOpen(!open)}>
        <span className={'caret' + (open ? ' open' : '')}>▶</span>
        <span className="bt">{bom.productName}</span>
        {bom.type === 'phantom' && <span className="kit">Kit</span>}
        <span className="bc">{bom.code || '—'} · {bom.lines.length} composant{bom.lines.length > 1 ? 's' : ''}</span>
      </div>
      {open && (
        <table><thead><tr><th style={{ paddingLeft: 32 }}>Composant</th><th>Référence</th><th className="r">Qté</th><th>Unité</th></tr></thead>
          <tbody>{bom.lines.map((l, i) => (
            <tr key={i} style={{ cursor: 'default' }}><td style={{ paddingLeft: 32 }}>{l.name}</td>
              <td className="code">{l.code || '—'}</td><td className="r">{l.qty}</td><td className="cap">{l.uom}</td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
};

export default App;
