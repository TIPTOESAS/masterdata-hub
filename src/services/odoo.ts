import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { Product, Bom, WritePayload } from '../types';

// Appels aux Cloud Functions qui parlent à Odoo (base TEST).
// Si les fonctions ne sont pas déployées/joignables, on retombe sur un échantillon
// embarqué pour que l'UI reste utilisable en dev.

const call = async <T>(name: string, data: any): Promise<T> => {
  const fn = httpsCallable(functions, name, { timeout: 300000 }); // 5 min (gros catalogue)
  const res = await fn(data);
  return res.data as T;
};

export const fetchProducts = async (): Promise<Product[]> => {
  try {
    return await call<Product[]>('odooListProducts', {});
  } catch (e) {
    console.warn('[odoo] fallback échantillon (fonction indisponible):', e);
    return SAMPLE;
  }
};

export const fetchBoms = async (productTmplId?: number): Promise<Bom[]> => {
  try {
    return await call<Bom[]>('odooListBoms', { productTmplId: productTmplId ?? null });
  } catch (e) {
    console.warn('[odoo] BOM indisponible:', e);
    return [];
  }
};

export const writeOdoo = async (payload: WritePayload): Promise<{ ok: boolean }> => {
  return call<{ ok: boolean }>('odooWrite', payload);
};

// Écriture en masse : mêmes valeurs sur plusieurs enregistrements.
export const writeManyOdoo = async (payload: { model: string; ids: number[]; values: Record<string, any> }): Promise<{ ok: boolean; count: number }> => {
  return call<{ ok: boolean; count: number }>('odooWriteMany', payload);
};

// --- échantillon minimal (extrait réel base test) pour le dev sans backend ---
const SAMPLE: Product[] = [
  {
    id: 6668, code: 'KST045S21UC', image: '', productState: 'prod', b2b: 'Oui', name: 'Tabouret LOU monochrome Wave x Uchronia',
    nameEn: 'LOU monochrome stool Wave x Uchronia', nameDe: 'LOU monochrome Hocker Wave x Uchronia',
    superCat: 'chair_and_stool', collection: 'lou', cat: 'stool', sub: 'stool', subcol: 'uchronia',
    odooCat: 'all / chair', dim: '450×300×300mm', weight: 5.4, volume: 0.041, barcode: '',
    hs: '94016900', origin: 'Bulgaria', uom: 'Units', pack: 'Carton x1', transport: 8.5,
    price: 157.5, cost: 43.69, saleOk: true, buyOk: true, active: true, supplier: 'Plasturgie Venezia',
    tiptoeRef: 'LOU-STOOL-UC', tiptoeType: 'Finished good', tiptoeTypeDetail: 'Stool',
    launch: '2025-03-14', woo: 'wc_20481',
    variants: [
      { id: 97040, sku: 'KST045S21UC126', attr: 'ice cream beige', color: '#ecdcc0', state: 'prod', b2b: true, availQty: 0, nextSupplyQty: 0, nextSupplyDate: '', supplier: 'Plasturgie Venezia', barcode: '3701499936173', price: 157.5, cost: 43.69, weight: 1, volume: 0, dimVariant: '450×300×300mm', hsVariant: '94014100', origin: 'Bulgaria', diameter: 'Ø300mm', dimPacked: '600×360×90mm', flatpack: 'yes', spidy: 'F0', pricePublic: 165.83, priceWholesale: 94.53, priceUsd: 320 },
      { id: 97041, sku: 'KST045S21UC226', attr: 'chocolate brown', color: '#5a3a26', state: 'prod', b2b: true, availQty: 0, nextSupplyQty: 0, nextSupplyDate: '', supplier: 'Plasturgie Venezia', barcode: '3701499936180', price: 157.5, cost: 43.69, weight: 1, volume: 0, dimVariant: '450×300×300mm', hsVariant: '94014100', origin: 'Bulgaria', diameter: 'Ø300mm', dimPacked: '600×360×90mm', flatpack: 'yes', spidy: 'F0', pricePublic: 165.83, priceWholesale: 94.53, priceUsd: 320 },
      { id: 97042, sku: 'KST045S21UC526', attr: 'astral purple', color: '#5b4a86', state: 'prod', b2b: true, availQty: 0, nextSupplyQty: 0, nextSupplyDate: '', supplier: 'Plasturgie Venezia', barcode: '3701499936159', price: 157.5, cost: 43.69, weight: 1, volume: 0, dimVariant: '450×300×300mm', hsVariant: '94014100', origin: 'Bulgaria', diameter: 'Ø300mm', dimPacked: '600×360×90mm', flatpack: 'yes', spidy: 'F0', pricePublic: 165.83, priceWholesale: 94.53, priceUsd: 320 },
      { id: 97043, sku: 'KST045S21UC826', attr: 'magma orange', color: '#d4691f', state: 'prod', b2b: true, availQty: 0, nextSupplyQty: 0, nextSupplyDate: '', supplier: 'Plasturgie Venezia', barcode: '3701499936166', price: 157.5, cost: 43.69, weight: 1, volume: 0, dimVariant: '450×300×300mm', hsVariant: '94014100', origin: 'Bulgaria', diameter: 'Ø300mm', dimPacked: '600×360×90mm', flatpack: 'yes', spidy: 'F0', pricePublic: 165.83, priceWholesale: 94.53, priceUsd: 320 },
    ],
  },
];
