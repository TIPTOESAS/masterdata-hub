// Contrat de données partagé front <-> Cloud Functions (Odoo).

export interface Variant {
  id: number;               // product.product id
  sku: string;              // default_code
  attr: string;             // libellé des valeurs d'attributs
  color?: string;           // couleur d'affichage (swatch)
  barcode: string;
  state: string;            // x_studio_product_state (dev/soon/prod/end_of_life/old)
  b2b: boolean;             // x_studio_saleable_in_wholesale (Available in b2b)
  availQty: number;         // x_available_qty (Qté disponible 2.0)
  nextSupplyQty: number;    // x_next_supply_qty (Qté prochaine appro 2.0)
  nextSupplyDate: string;   // x_next_supply_date (Prochaine appro 2.0)
  supplier: string;         // x_studio_char_field_6T0cm (Default Supplier)
  price: number;            // lst_price
  cost: number;             // standard_price
  weight: number;
  volume: number;
  dimVariant: string;       // x_studio_dimensions_variant
  hsVariant: string;        // x_studio_hs_code_variant
  origin: string;           // x_studio_country_of_origin_variant
  diameter: string;         // x_studio_diameter
  dimPacked: string;        // x_studio_dimensions_packed
  flatpack: string;         // x_studio_flatpack
  spidy: string;            // x_studio_gamme_famille_spidy
  pricePublic: number | null;
  priceWholesale: number | null;
  priceUsd: number | null;
}

export interface Product {
  id: number;               // product.template id
  code: string;             // default_code
  image: string;            // image_128 en data:URL ('' si aucune)
  productState: string;     // x_studio_product_state représentatif (1re variante)
  b2b: string;              // 'Oui'/'Non' — au moins une variante saleable_in_wholesale

  name: string;             // nom (fr)
  nameEn: string;
  nameDe: string;
  superCat: string;         // x_super_category
  collection: string;       // x_collection
  cat: string;              // x_category
  sub: string;              // x_sub_category
  subcol: string;           // x_sub_collection
  odooCat: string;          // categ_id
  dim: string;              // x_studio_dimensions
  weight: number;
  volume: number;
  barcode: string;
  hs: string;               // hs_code
  origin: string;
  uom: string;
  pack: string;
  transport: number;        // x_studio_transport_cost
  price: number;            // list_price
  cost: number;             // standard_price
  saleOk: boolean;
  buyOk: boolean;
  active: boolean;
  supplier: string;         // fournisseur par défaut
  tiptoeRef: string;        // x_studio_tiptoe_ref
  tiptoeType: string;       // x_studio_tiptoe_type
  tiptoeTypeDetail: string; // x_studio_tiptoe_type_detail
  launch: string;           // x_studio_launch_date
  woo: string;              // x_studio_woo_tmpl_id
  variants: Variant[];
}

export interface BomLine {
  productId: number;        // composant product.product id
  code: string;             // default_code du composant
  name: string;
  qty: number;
  uom: string;
}

export interface Bom {
  id: number;               // mrp.bom id
  productTmplId: number;
  productName: string;
  parentCode: string;       // default_code du produit parent (SKU parent)
  superCat: string;
  collection: string;
  cat: string;
  sub: string;
  code: string;             // référence BOM
  type: string;             // normal / phantom (kit)
  qty: number;              // quantité produite
  lines: BomLine[];
}

// Écriture générique vers Odoo : modèle + id + champs modifiés.
export interface WritePayload {
  model: 'product.template' | 'product.product' | 'product.pricelist.item';
  id: number;
  values: Record<string, any>;
}
