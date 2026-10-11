"use server";

import { requireOrgMember } from "@/lib/auth";
import { getBrands, type Brand } from "./brands/brands-data";
import { getProducts, type Product } from "./brands/[brandId]/products/products-data";

/**
 * Thin server-action wrappers around the brand/product data functions
 * so the sidebar's "Create ad" and "Products" popups (client
 * components, since they react to the editor's picks step by step)
 * can fetch brands and a brand's products without a full page
 * navigation between each step.
 */
export async function listBrandsForPicker(orgId: string): Promise<Brand[]> {
  await requireOrgMember(orgId);
  return getBrands(orgId);
}

export async function listProductsForPicker(orgId: string, brandId: string): Promise<Product[]> {
  await requireOrgMember(orgId);
  return getProducts(orgId, brandId);
}
