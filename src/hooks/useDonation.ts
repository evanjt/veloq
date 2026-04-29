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
        await initConnection();
        const items = await fetchProducts({ skus: PRODUCT_IDS });
        const productList = (items ?? []) as Product[];
        if (mounted) {
          setState((s) => ({
            ...s,
            products: productList,
            isAvailable: productList.length > 0,
            isLoading: false,
          }));
        }
      } catch {
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
          }, 3000);
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
