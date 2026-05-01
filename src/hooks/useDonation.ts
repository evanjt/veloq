import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type Product,
  type PurchaseError,
} from 'react-native-iap';
import { useSupportStore } from '@/providers';

const PRODUCT_IDS = ['tip_small', 'tip_medium', 'tip_large'];
const THANK_YOU_DISPLAY_MS = 3000;

interface DonationState {
  products: Product[];
  isAvailable: boolean;
  isLoading: boolean;
  isPurchasing: boolean;
  purchaseSuccess: boolean;
}

export function useDonation() {
  const [state, setState] = useState<DonationState>({
    products: [],
    isAvailable: false,
    isLoading: true,
    isPurchasing: false,
    purchaseSuccess: false,
  });

  const recordAction = useSupportStore((s) => s.recordAction);

  useEffect(() => {
    let purchaseUpdateSub: ReturnType<typeof purchaseUpdatedListener> | null = null;
    let purchaseErrorSub: ReturnType<typeof purchaseErrorListener> | null = null;
    let mounted = true;

    async function init() {
      try {
        if (__DEV__) console.log('[IAP] initConnection...');
        await initConnection();
        if (__DEV__) console.log('[IAP] fetchProducts...');
        const items = await fetchProducts({ skus: PRODUCT_IDS });
        if (__DEV__) console.log('[IAP] got', items?.length ?? 0, 'products');
        const productList = (items ?? []) as Product[];
        if (mounted) {
          setState((s) => ({
            ...s,
            products: productList,
            isAvailable: productList.length > 0,
            isLoading: false,
          }));
        }
      } catch (e: unknown) {
        if (__DEV__) console.warn('[IAP] init failed:', e);
        if (mounted) {
          setState((s) => ({ ...s, isAvailable: false, isLoading: false }));
        }
      }

      purchaseUpdateSub = purchaseUpdatedListener(async (purchase: Purchase) => {
        await finishTransaction({ purchase, isConsumable: true });
        if (mounted) {
          recordAction();
          setState((s) => ({ ...s, isPurchasing: false, purchaseSuccess: true }));
          setTimeout(() => {
            if (mounted) setState((s) => ({ ...s, purchaseSuccess: false }));
          }, THANK_YOU_DISPLAY_MS);
        }
      });

      purchaseErrorSub = purchaseErrorListener((_error: PurchaseError) => {
        if (mounted) {
          setState((s) => ({ ...s, isPurchasing: false }));
        }
      });
    }

    init();

    return () => {
      mounted = false;
      purchaseUpdateSub?.remove();
      purchaseErrorSub?.remove();
      endConnection();
    };
  }, [recordAction]);

  const purchase = useCallback(async (productId: string) => {
    setState((s) => ({ ...s, isPurchasing: true }));
    try {
      if (Platform.OS === 'ios') {
        await requestPurchase({
          request: { apple: { sku: productId } },
          type: 'in-app',
        });
      } else {
        await requestPurchase({
          request: { google: { skus: [productId] } },
          type: 'in-app',
        });
      }
    } catch {
      setState((s) => ({ ...s, isPurchasing: false }));
    }
  }, []);

  return {
    products: state.products,
    isAvailable: state.isAvailable,
    isLoading: state.isLoading,
    isPurchasing: state.isPurchasing,
    purchaseSuccess: state.purchaseSuccess,
    purchase,
  };
}
