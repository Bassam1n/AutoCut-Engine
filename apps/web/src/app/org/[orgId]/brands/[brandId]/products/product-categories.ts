// Shared between server (products-data.ts) and client (product-form.tsx)
// code — deliberately has no "server-only" import, unlike
// products-data.ts, since product-form.tsx needs these constants too.

export const PRODUCT_CATEGORIES = [
  "supplements",
  "skincare",
  "fitness",
  "pain_relief",
  "wearables",
  "home_products",
  "apparel",
  "beauty",
  "food_beverage",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  supplements: "Supplements",
  skincare: "Skincare",
  fitness: "Fitness",
  pain_relief: "Pain relief",
  wearables: "Wearables",
  home_products: "Home products",
  apparel: "Apparel",
  beauty: "Beauty",
  food_beverage: "Food & beverage",
  other: "Other",
};
