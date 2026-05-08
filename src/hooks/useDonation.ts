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
import i18next from 'i18next';
import { useSupportStore } from '@/providers';

const PRODUCT_IDS = ['tip_small', 'tip_medium', 'tip_large'];
const THANK_YOU_DISPLAY_MS = 3000;
const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 1000;

const FALLBACK_KEYS: Record<string, string> = {
  tip_small: 'support.tip_small',
  tip_medium: 'support.tip_medium',
  tip_large: 'support.tip_large',
};

function iosFallbackProducts(): Product[] {
  return PRODUCT_IDS.map((id) => ({
    id,
    displayPrice: FALLBACK_KEYS[id] ? i18next.t(FALLBACK_KEYS[id] as 'support.tip_small') : id,
  })) as unknown as Product[];
}

async function fetchWithRetry(): Promise<Product[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    try {
      const items = await fetchProducts({ skus: PRODUCT_IDS });
      return (items ?? []) as Product[];
    } catch (e) {
      lastError = e;
      if (attempt < FETCH_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

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

    function applyIosFallback() {
      if (mounted && Platform.OS === 'ios') {
        setState((s) => ({
          ...s,
          isAvailable: true,
          products: iosFallbackProducts(),
          isLoading: false,
        }));
        return true;
      }
      return false;
    }

    async function init() {
      try {
        await initConnection();
        const productList = await fetchWithRetry();
        if (mounted) {
          if (productList.length > 0) {
            setState((s) => ({
              ...s,
              products: productList,
              isAvailable: true,
              isLoading: false,
            }));
          } else {
            console.warn('[IAP] fetchProducts returned empty');
            if (!applyIosFallback()) {
              setState((s) => ({ ...s, isAvailable: false, isLoading: false }));
            }
          }
        }
      } catch (e: unknown) {
        console.warn('[IAP] init failed:', e);
        if (!applyIosFallback()) {
          if (mounted) {
            setState((s) => ({ ...s, isAvailable: false, isLoading: false }));
          }
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
      endConnection().catch(() => {});
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
