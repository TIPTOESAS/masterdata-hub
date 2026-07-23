# TIPTOE · Master Data Hub

Hub de gestion de la **master data produit** : hiérarchie (super-catégorie › collection › catégorie › sous-catégorie), `product.template` / `product.product`, logistique & dimensions, champs custom, **pricing** (public / wholesale / USD), traductions et **nomenclatures (BOM)**. Lecture **et** écriture retour dans Odoo.

## Stack
- **Front** : React 19 + TypeScript (Create React App), hébergé sur Firebase Hosting.
- **Auth** : Firebase Auth (Google), restreinte aux comptes `@tiptoe.fr`.
- **Backend** : Firebase Cloud Functions (v2, `europe-west1`) → Odoo via JSON-RPC.
- **Odoo** : base **TEST** (`falinwa-tiptoe15-test-…`).

Projet Firebase : `tiptoe-masterdata-hub`.

## Développement
```bash
npm install
npm start            # front sur http://localhost:3000
```
Pour les données réelles, déployer les fonctions (ou lancer l'émulateur avec `functions/.env`).

## Cloud Functions
```bash
cd functions && npm install
npm run build
```
Endpoints callables (auth `@tiptoe.fr` requise) :
- `odooListProducts` — templates + variantes + pricing + fournisseur + type
- `odooListBoms` — nomenclatures (mrp.bom) globales ou par template
- `odooTranslations` — nom par langue
- `odooWrite` — écriture `{ model, id, values }` (product.template / product.product / product.pricelist.item)

### Secrets (base TEST)
```bash
firebase functions:secrets:set ODOO_URL
firebase functions:secrets:set ODOO_DB
firebase functions:secrets:set ODOO_USER
firebase functions:secrets:set ODOO_KEY
firebase deploy --only functions
```

## Déploiement front
```bash
npm run deploy       # build + firebase deploy --only hosting
```
