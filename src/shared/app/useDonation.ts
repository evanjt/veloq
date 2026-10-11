import { useEffect, useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useIAP,
  getAvailablePurchases,
  ErrorCode,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { useSupportStore } from '@/shared/app/SupportStore';

const PRODUCT_IDS = ['tip_small', 'tip_medium', 'tip_large'];
const THANK_YOU_DISPLAY_MS = 3000;

function purchaseKey(purchase: Purchase): string {
  return purchase.purchaseToken ?? purchase.id;
}

/** A tip the store has been paid for. A pending or unknown purchase has moved no money yet. */
function isPaidTip(purchase: Purchase): boolean {
  return PRODUCT_IDS.includes(purchase.productId) && purchase.purchaseState === 'purchased';
}

export function useDonation() {
  const recordAction = useSupportStore((s) => s.recordAction);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [hasSwept, setHasSwept] = useState(false);
  // Tips being consumed or already consumed, so the listener and the sweep never consume one twice.
  const settlingRef = useRef(new Set<string>());

  // A tip is a consumable: the store refunds it unless it is consumed, and it cannot be bought
  // again until then. Resolves true only when this call consumed it.
  const settleTip = useCallback(
    async (purchase: Purchase, finish: typeof finishTransaction): Promise<boolean> => {
      const key = purchaseKey(purchase);
      if (settlingRef.current.has(key)) return false;
      settlingRef.current.add(key);
      try {
        await finish({ purchase, isConsumable: true });
      } catch (e) {
        settlingRef.current.delete(key);
        console.warn('[IAP] finishTransaction threw:', e);
        return false;
      }
      recordAction();
      return true;
    },
    [recordAction]
  );

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: async (purchase: Purchase) => {
      setIsPurchasing(false);
      if (!isPaidTip(purchase)) return;
      if (!(await settleTip(purchase, finishTransaction))) return;
      setPurchaseSuccess(true);
      setTimeout(() => setPurchaseSuccess(false), THANK_YOU_DISPLAY_MS);
    },
    onPurchaseError: (error: PurchaseError) => {
      setIsPurchasing(false);
      if (error.code !== ErrorCode.UserCancelled) {
        console.warn('[IAP] purchase error:', error.code, error.message);
      }
    },
    onError: (error: Error) => {
      console.warn('[IAP] non-purchase error:', error.message);
    },
  });

  useEffect(() => {
    if (!connected || hasFetched) return;
    setHasFetched(true);
    fetchProducts({ skus: PRODUCT_IDS, type: 'in-app' }).catch((e) => {
      console.warn('[IAP] fetchProducts threw:', e);
    });
  }, [connected, hasFetched, fetchProducts]);

  // A tip whose payment completed after its card unmounted, or whose consume failed, is still
  // held unconsumed by the store. Consume it on the next connection, before it is refunded.
  useEffect(() => {
    if (!connected || hasSwept) return;
    setHasSwept(true);
    getAvailablePurchases()
      .then(async (held) => {
        for (const purchase of held ?? []) {
          if (isPaidTip(purchase)) await settleTip(purchase, finishTransaction);
        }
      })
      .catch((e) => {
        console.warn('[IAP] getAvailablePurchases threw:', e);
      });
  }, [connected, hasSwept, settleTip, finishTransaction]);

  const retry = useCallback(() => {
    if (!connected) return;
    fetchProducts({ skus: PRODUCT_IDS, type: 'in-app' }).catch((e) => {
      console.warn('[IAP] retry fetchProducts threw:', e);
    });
  }, [connected, fetchProducts]);

  const purchase = useCallback(
    async (productId: string) => {
      setIsPurchasing(true);
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
      } catch (e) {
        console.warn('[IAP] requestPurchase threw:', e);
        setIsPurchasing(false);
      }
    },
    [requestPurchase]
  );

  const isLoading = !connected || (connected && !hasFetched);
  const isAvailable = connected && products.length > 0;

  return {
    products,
    isAvailable,
    isLoading,
    isPurchasing,
    purchaseSuccess,
    purchase,
    retry,
  };
}
