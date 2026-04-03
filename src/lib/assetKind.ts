import type { BasketAssetKind } from '@/types/basket';

export type ContractBasketAssetKind = 'Vara' | 'Bet';

export const FT_ASSET_KIND: BasketAssetKind = 'FT';

export const normalizeAssetKind = (
  assetKind?: BasketAssetKind | ContractBasketAssetKind | null,
): BasketAssetKind => {
  if (assetKind === 'Bet' || assetKind === 'FT') {
    return 'FT';
  }

  return 'Vara';
};

export const toContractAssetKind = (
  assetKind: BasketAssetKind,
): ContractBasketAssetKind => (assetKind === 'FT' ? 'Bet' : 'Vara');

export const isFtAssetKind = (
  assetKind?: BasketAssetKind | ContractBasketAssetKind | null,
): boolean => normalizeAssetKind(assetKind) === 'FT';
