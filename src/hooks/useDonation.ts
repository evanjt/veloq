import { useEffect, useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useIAP, ErrorCode, type Purchase, type PurchaseError } from 'react-native-iap';
import { useSupportStore } from '@/providers';

const PRODUCT_IDS = ['tip_small', 'tip_medium', 'tip_large'];
const THANK_YOU_DISPLAY_MS = 3000;

export function useDonation() {
  const recordAction = useSupportStore((s) => s.recordAction);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: async (purchase: Purchase) => {
      try {
        await finishTransaction({ purchase, isConsumable: true });
      } catch {
        // ignore — purchase still succeeded from user perspective
      }
      recordAction();
      setIsPurchasing(false);
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
