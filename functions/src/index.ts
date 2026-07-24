import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { listProducts, listBoms, getTranslations, writeRecord, writeRecords, exportVariants, OdooConfig } from './odoo';

setGlobalOptions({ region: 'europe-west1', maxInstances: 5, memory: '1GiB', timeoutSeconds: 300 });

const ODOO_URL = defineSecret('ODOO_URL');
const ODOO_DB = defineSecret('ODOO_DB');
const ODOO_USER = defineSecret('ODOO_USER');
const ODOO_KEY = defineSecret('ODOO_KEY');
const secrets = [ODOO_URL, ODOO_DB, ODOO_USER, ODOO_KEY];

function cfg(): OdooConfig {
  return { url: ODOO_URL.value(), db: ODOO_DB.value(), user: ODOO_USER.value(), key: ODOO_KEY.value() };
}

// Administrateurs autorisés à écrire dans Odoo (le reste est en lecture seule).
const ADMINS = new Set(['bastien@tiptoe.fr', 'brice@tiptoe.fr']);

// Garde lecture : tout compte @tiptoe.fr authentifié.
function guard(req: CallableRequest): string {
  const email = (req.auth?.token?.email as string | undefined)?.toLowerCase();
  if (!email || !/@tiptoe\.fr$/.test(email)) {
    throw new HttpsError('permission-denied', 'Accès réservé aux comptes @tiptoe.fr');
  }
  return email;
}

// Garde écriture : uniquement les administrateurs.
function guardAdmin(req: CallableRequest) {
  const email = guard(req);
  if (!ADMINS.has(email)) {
    throw new HttpsError('permission-denied', 'Modification réservée aux administrateurs (Bastien, Brice).');
  }
}

const WRITABLE = new Set(['product.template', 'product.product', 'product.pricelist.item']);

export const odooListProducts = onCall({ secrets }, async (req) => {
  guard(req);
  const limit = typeof req.data?.limit === 'number' ? req.data.limit : 3000;
  return listProducts(cfg(), { limit });
});

export const odooListBoms = onCall({ secrets }, async (req) => {
  guard(req);
  return listBoms(cfg(), { productTmplId: req.data?.productTmplId ?? null });
});

export const odooTranslations = onCall({ secrets }, async (req) => {
  guard(req);
  const id = Number(req.data?.tmplId);
  if (!id) throw new HttpsError('invalid-argument', 'tmplId requis');
  return getTranslations(cfg(), id);
});

export const odooExportVariants = onCall({ secrets }, async (req) => {
  guard(req);
  const ids = Array.isArray(req.data?.ids) ? req.data.ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : [];
  if (!ids.length) throw new HttpsError('invalid-argument', 'ids[] requis');
  return exportVariants(cfg(), ids);
});

export const odooWrite = onCall({ secrets }, async (req) => {
  guardAdmin(req);
  const { model, id, values } = req.data || {};
  if (!WRITABLE.has(model)) throw new HttpsError('invalid-argument', `Modèle non autorisé: ${model}`);
  if (!id || typeof values !== 'object') throw new HttpsError('invalid-argument', 'id/values requis');
  const ok = await writeRecord(cfg(), model, Number(id), values);
  return { ok };
});

export const odooWriteMany = onCall({ secrets }, async (req) => {
  guardAdmin(req);
  const { model, ids, values } = req.data || {};
  if (!WRITABLE.has(model)) throw new HttpsError('invalid-argument', `Modèle non autorisé: ${model}`);
  if (!Array.isArray(ids) || !ids.length || typeof values !== 'object') throw new HttpsError('invalid-argument', 'ids[]/values requis');
  const clean = ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
  const ok = await writeRecords(cfg(), model, clean, values);
  return { ok, count: clean.length };
});
