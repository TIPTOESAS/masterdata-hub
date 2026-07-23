import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { onAuthChange, signOutUser } from './services/auth';
import { fetchProducts, fetchBoms, writeOdoo } from './services/odoo';
import { Product, Variant, Bom } from './types';
import Login from './components/Login';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const money = (v: number | null, cur = '€') =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
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
};
const NUMERIC = new Set(['price', 'cost', 'weight', 'volume', 'transport']);

const STATES: [string, string][] = [['dev', 'Development'], ['soon', 'Upcoming'], ['prod', 'Active'], ['end_of_life', 'End of Life'], ['old', 'Old']];
const stateLabel = (s: string) => STATES.find((x) => x[0] === s)?.[1] || s || '—';

type Edits = Record<string, string | boolean>;

// clé de facette -> propriété du produit
type FKey = 'superCat' | 'collection' | 'cat' | 'sub' | 'subcol' | 'supplier' | 'productState' | 'tiptoeType';
const FACETS: { key: FKey; label: string; scroll?: boolean; state?: boolean }[] = [
  { key: 'superCat', label: 'Super-catégorie' },
  { key: 'collection', label: 'Collection', scroll: true },
  { key: 'cat', label: 'Catégorie', scroll: true },
  { key: 'sub', label: 'Sous-catégorie', scroll: true },
  { key: 'subcol', label: 'Sous-collection', scroll: true },
  { key: 'tiptoeType', label: 'TipToe type', scroll: true },
  { key: 'supplier', label: 'Fournisseur par défaut', scroll: true },
  { key: 'productState', label: 'État produit', state: true },
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

  useEffect(() => { fetchProducts().then(setProducts); }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo"><span className="mark">◆</span>Master Data Hub <span className="sub">· Produits</span></div>
        <div className="nav">
          <button className={view === 'products' ? 'on' : ''} onClick={() => setView('products')}>Produits</button>
          <button className={view === 'boms' ? 'on' : ''} onClick={() => setView('boms')}>Nomenclatures</button>
        </div>
        <div className="gsearch"><span className="mag">🔍</span>
          <input placeholder="Rechercher réf, nom, code-barres…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="env">
          <span className="badge-env">● ODOO · TEST</span>
          <span className="av" title={user.email} onClick={() => signOutUser()}>
            {(user.email || '?')[0].toUpperCase()}</span>
        </div>
      </div>
      {view === 'products'
        ? <ProductsView products={products} setProducts={setProducts} q={q.toLowerCase()} />
        : <BomView q={q.toLowerCase()} />}
    </div>
  );
};

// ============================== Products view ==============================
const emptySets = (): Record<FKey, Set<string>> =>
  ({ superCat: new Set(), collection: new Set(), cat: new Set(), sub: new Set(), subcol: new Set(), tiptoeType: new Set(), supplier: new Set(), productState: new Set() });

const ProductsView: React.FC<{
  products: Product[] | null; setProducts: (p: Product[]) => void; q: string;
}> = ({ products, setProducts, q }) => {
  const [sets, setSets] = useState<Record<FKey, Set<string>>>(emptySets());
  const [status, setStatus] = useState('active');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<Product | null>(null);

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
      const h = (p.code + ' ' + p.name + ' ' + p.nameEn + ' ' + p.barcode + ' ' + p.tiptoeRef).toLowerCase();
      if (!h.includes(q)) return false;
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
    id: p.id, sku: p.code || '—', attr: 'variante unique', color: '#ccd1d8', state: p.productState, barcode: p.barcode, price: p.price,
    cost: p.cost, weight: p.weight, volume: p.volume, dimVariant: p.dim, hsVariant: p.hs, origin: p.origin,
    diameter: '', dimPacked: '', flatpack: '', spidy: '', pricePublic: null, priceWholesale: null, priceUsd: null,
  }];

  const applyWrite = (updated: Product) => {
    setProducts((products || []).map((p) => (p.id === updated.id ? updated : p)));
    setSel(updated);
  };

  if (!products) return <div className="loading">Chargement des produits depuis Odoo…</div>;

  const renderFacet = (key: FKey, label: string, scroll?: boolean, isState?: boolean) => {
    const counts = facetCounts(key);
    let keys = Object.keys(counts);
    keys = isState ? STATES.map((s) => s[0]).filter((k) => counts[k]) : keys.sort();
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
        {FACETS.map((f) => renderFacet(f.key, f.label, f.scroll, f.state))}
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
          <span className="count">{list.length} template{list.length > 1 ? 's' : ''} · {products.length} chargés</span>
          <div className="actions">
            <button className="btn" onClick={() => setExpanded(expanded.size ? new Set() : new Set(list.map((p) => p.id)))}>
              ⇕ {expanded.size ? 'Tout replier' : 'Tout déplier'}</button>
          </div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th style={{ width: 24 }}></th><th>Référence</th><th>Produit</th><th>Hiérarchie</th>
              <th>TipToe type</th><th>État</th><th>Dimensions</th><th className="r">Var.</th><th className="r">Prix</th><th>Dispo.</th>
            </tr></thead>
            <tbody>
              {list.map((p) => {
                const vs = effVariants(p); const open = expanded.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                    <tr className={'trow' + (open ? ' open' : '')}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('.exp')) {
                          const n = new Set(expanded); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setExpanded(n);
                        } else setSel(p);
                      }}>
                      <td className="exp"><span className={'caret' + (open ? ' open' : '')}>▶</span></td>
                      <td className="code">{p.code || '—'}</td>
                      <td><div className="pcell">
                        {p.image ? <img className="thumb" src={p.image} alt="" /> : <span className="thumb ph">◆</span>}
                        <div><div className="pname">{p.name}</div>{p.nameEn !== p.name && <div className="psub">{p.nameEn}</div>}</div>
                      </div></td>
                      <td><span className="hchip col">{p.collection || '—'}</span> {p.cat && <span className="hchip">{p.cat}</span>}</td>
                      <td>{p.tiptoeType ? <span className="tt">{p.tiptoeType}</span> : <span className="cap">—</span>}</td>
                      <td>{p.productState ? <span className={'stbadge s-' + p.productState}>{stateLabel(p.productState)}</span> : '—'}</td>
                      <td className="dim">{p.dim || '—'}</td>
                      <td className="r"><span className="vcount">{vs.length}</span></td>
                      <td className="r price">{money(p.price)}</td>
                      <td><span className="st">
                        <span className={'dot ' + (p.active ? 'on' : 'off')} title={p.active ? 'Actif' : 'Archivé'}></span>
                        <span className={'dot ' + (p.saleOk ? 'sale' : 'off')} title="Vendable"></span>
                        <span className={'dot ' + (p.buyOk ? 'buy' : 'off')} title="Achetable"></span>
                      </span></td>
                    </tr>
                    {open && vs.map((v, i) => (
                      <tr className="vrow" key={p.id + '-' + i} onClick={() => setSel(p)}>
                        <td className="exp"></td>
                        <td className="code">{v.sku}</td>
                        <td><span className="swatch" style={{ background: v.color || '#ccd1d8' }}></span>{v.attr}</td>
                        <td>{v.barcode ? <span className="ean">EAN {v.barcode}</span> : <span className="ean" style={{ color: 'var(--faint)' }}>—</span>}</td>
                        <td></td>
                        <td>{v.state ? <span className={'stbadge s-' + v.state}>{stateLabel(v.state)}</span> : ''}</td>
                        <td className="dim">{v.dimVariant || '—'}</td>
                        <td></td>
                        <td className="r price">{money(v.price)}</td>
                        <td><span className="vopen">détail ›</span></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {!list.length && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>Aucun produit.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {sel && <Drawer product={sel} onClose={() => setSel(null)} onWrite={applyWrite} />}
    </div>
  );
};

// ============================== Drawer ==============================
const TABS: [string, string][] = [
  ['general', 'Général'], ['hierarchy', 'Hiérarchie'], ['logistics', 'Logistique & Dimensions'],
  ['custom', 'Champs custom'], ['variants', 'Variantes'], ['translations', 'Traductions'], ['bom', 'Nomenclature'],
];
const SUPERS = ['sofa', 'accessory', 'chair_and_stool', 'various', 'shelf', 'lamp', 'professional_furniture', 'table_leg', 'storage', 'table_and_desk'];

const Drawer: React.FC<{ product: Product; onClose: () => void; onWrite: (p: Product) => void }> = ({ product, onClose, onWrite }) => {
  const [tab, setTab] = useState('general');
  const [variantIdx, setVariantIdx] = useState<number | null>(null);
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

  const fld = (label: string, key: string, orig: any, opts: { full?: boolean; ro?: boolean; hint?: string; select?: string[] } = {}) => {
    const val = cur(key, orig ?? '');
    const dc = !opts.ro && isDirty(key, orig ?? '') ? ' dirty' : '';
    const lab = <label>{label}{opts.hint && <span className="fhint">{opts.hint}</span>}</label>;
    return (
      <div className={'field' + (opts.full ? ' full' : '')} key={key}>
        {lab}
        {opts.select
          ? <select className={'in' + dc} value={String(val)} disabled={opts.ro} onChange={(e) => setField(key, orig ?? '', e.target.value)}>
              {opts.select.map((o) => <option key={o}>{o}</option>)}</select>
          : <input className={'in' + dc} value={String(val ?? '')} readOnly={opts.ro} onChange={(e) => setField(key, orig ?? '', e.target.value)} />}
      </div>
    );
  };
  const tog = (label: string, key: string, orig: boolean) => {
    const on = cur(key, orig) === true || cur(key, orig) === 'true';
    return <div className="toggle" key={key}><div className={'switch' + (on ? ' on' : '')} onClick={() => setField(key, orig, !on)}></div><span>{label}</span></div>;
  };

  return (
    <>
      <div className="scrim show" onClick={onClose}></div>
      <aside className="drawer show">
        {variant ? (
          <div className="dh"><div style={{ flex: 1, minWidth: 0 }}>
            <button className="back" onClick={backToTemplate}>‹ Retour au template</button>
            <div className="dt" style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="swatch" style={{ background: variant.color || '#ccd1d8', width: 16, height: 16 }}></span>{variant.attr}</div>
            <div className="dcode">{variant.sku} · product.product · variante de « {product.name} »</div>
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
          ? <VariantBody variant={variant} fld={fld} />
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
          <span className="status">{dirtyCount ? <><b>{dirtyCount} champ{dirtyCount > 1 ? 's' : ''} modifié{dirtyCount > 1 ? 's' : ''}</b> · prêt</> : 'Aucune modification'}</span>
          <span className="model-tag">→ {variant ? 'product.product' : 'product.template'}</span>
          <span className="spacer"></span>
          <button className="btn-ghost" disabled={!dirtyCount || saving} onClick={reset}>Annuler</button>
          <button className="btn-write" disabled={!dirtyCount || saving} onClick={save}>{saving ? 'Écriture…' : '⬆ Écrire dans Odoo'}</button>
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
              <td><span className="swatch" style={{ background: v.color || '#ccd1d8' }}></span>{v.attr}</td>
              <td className="code">{v.sku}</td><td className="code">{v.barcode || '—'}</td>
              <td className="r price">{money(v.price)}</td>
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
const VariantBody: React.FC<{ variant: Variant; fld: any }> = ({ variant: v, fld }) => {
  const [vtab, setVtab] = useState<'fields' | 'pricing'>('fields');
  const base = v.pricePublic;                                  // marge calculée sur le public HT
  const marginAbs = base != null ? base - v.cost : null;
  const marginPct = base ? Math.round((marginAbs! / base) * 1000) / 10 : null;
  return (
    <>
      <div className="dtabs">
        <span className={'dtab' + (vtab === 'fields' ? ' on' : '')} onClick={() => setVtab('fields')}>Champs</span>
        <span className={'dtab' + (vtab === 'pricing' ? ' on' : '')} onClick={() => setVtab('pricing')}>Pricing</span>
      </div>
      <div className="dbody">
        {vtab === 'fields' ? (
          <>
            <div className="sectitle">Champs propres à la variante (product.product)</div>
            <div className="grp2">
              {fld('Référence interne', 'sku', v.sku, { hint: 'default_code' })}
              {fld('Code-barres (EAN)', 'barcode', v.barcode, { hint: 'barcode' })}
              {fld('Coût (€)', 'cost', v.cost, { hint: 'standard_price' })}
              {fld('Prix de vente (€)', 'price', v.price, { hint: 'lst_price', ro: true })}
              {fld('Poids (kg)', 'weight', v.weight, { hint: 'weight' })}
              {fld('Volume (m³)', 'volume', v.volume, { hint: 'volume' })}
              {fld('Dimensions (variante)', 'dimVariant', v.dimVariant, { full: true, hint: 'x_studio_dimensions_variant' })}
              {fld('Dimensions emballé', 'dimPacked', v.dimPacked, { hint: 'x_studio_dimensions_packed' })}
              {fld('Diamètre', 'diameter', v.diameter, { hint: 'x_studio_diameter' })}
              {fld('Code HS (variante)', 'hsVariant', v.hsVariant, { hint: 'x_studio_hs_code_variant' })}
              {fld('Origine (variante)', 'origin', v.origin, { ro: true, hint: 'x_studio_country_of_origin_variant' })}
              {fld('Flatpack', 'flatpack', v.flatpack, { select: ['', 'yes', 'no'], hint: 'x_studio_flatpack' })}
              {fld('Gamme / Famille Spidy', 'spidy', v.spidy, { hint: 'x_studio_gamme_famille_spidy' })}
            </div>
          </>
        ) : (
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
        )}
      </div>
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
