/**
 * Scenario: a tip is a consumable, so the store refunds it unless the app consumes it, and the
 * same tip cannot be bought again until it is consumed. A purchase can arrive still pending
 * (a deferred payment method), the consume call can fail, and a pending purchase can complete
 * while no support card is mounted to hear it.
 *
 * Expected behaviour: only a paid tip is consumed, recorded and thanked; a pending one shows
 * nothing; a failed consume is neither recorded nor thanked; and every paid tip left unconsumed
 * is consumed the next time the billing connection opens.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Purchase } from 'react-native-iap';

import { useDonation } from '@/shared/app/useDonation';

type Options = { onPurchaseSuccess: (purchase: Purchase) => Promise<void> };

let mockOptions: Options | null = null;
let mockConnected = false;
const mockFinishTransaction = jest.fn();
const mockGetAvailablePurchases = jest.fn();
const mockRecordAction = jest.fn();

jest.mock('react-native-iap', () => ({
  useIAP: (options: Options) => {
    mockOptions = options;
    return {
      connected: mockConnected,
      products: [],
      fetchProducts: jest.fn(() => Promise.resolve()),
      requestPurchase: jest.fn(() => Promise.resolve()),
      finishTransaction: mockFinishTransaction,
    };
  },
  getAvailablePurchases: (...args: unknown[]) => mockGetAvailablePurchases(...args),
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

jest.mock('@/shared/app/SupportStore', () => ({
  useSupportStore: (selector: (s: unknown) => unknown) =>
    selector({ recordAction: mockRecordAction }),
}));

function tip(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'order-1',
    productId: 'tip_small',
    purchaseState: 'purchased',
    purchaseToken: 'token-1',
    platform: 'android',
    quantity: 1,
    transactionDate: 0,
    isAutoRenewing: false,
    store: 'google',
    ...overrides,
  } as Purchase;
}

async function deliver(purchase: Purchase) {
  await act(async () => {
    await mockOptions!.onPurchaseSuccess(purchase);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockOptions = null;
  mockConnected = false;
  mockFinishTransaction.mockReset().mockResolvedValue(undefined);
  mockGetAvailablePurchases.mockReset().mockResolvedValue([]);
  mockRecordAction.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a tip delivered to the purchase listener', () => {
  it('is consumed, recorded and thanked once it is paid', async () => {
    const { result } = renderHook(() => useDonation());

    await deliver(tip());

    expect(mockFinishTransaction).toHaveBeenCalledWith({
      purchase: expect.objectContaining({ purchaseToken: 'token-1' }),
      isConsumable: true,
    });
    expect(mockRecordAction).toHaveBeenCalledTimes(1);
    expect(result.current.purchaseSuccess).toBe(true);
    expect(result.current.isPurchasing).toBe(false);
  });

  it('is neither consumed nor thanked while its payment is pending', async () => {
    const { result } = renderHook(() => useDonation());
    await act(async () => {
      await result.current.purchase('tip_small');
    });
    expect(result.current.isPurchasing).toBe(true);

    await deliver(tip({ purchaseState: 'pending' }));

    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(mockRecordAction).not.toHaveBeenCalled();
    expect(result.current.purchaseSuccess).toBe(false);
    expect(result.current.isPurchasing).toBe(false);
  });

  it('is neither consumed nor thanked in an unknown state', async () => {
    const { result } = renderHook(() => useDonation());

    await deliver(tip({ purchaseState: 'unknown' }));

    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(mockRecordAction).not.toHaveBeenCalled();
    expect(result.current.purchaseSuccess).toBe(false);
  });

  it('is not recorded or thanked when the consume fails', async () => {
    mockFinishTransaction.mockRejectedValue(new Error('service unavailable'));
    const { result } = renderHook(() => useDonation());

    await deliver(tip());

    expect(mockFinishTransaction).toHaveBeenCalledTimes(1);
    expect(mockRecordAction).not.toHaveBeenCalled();
    expect(result.current.purchaseSuccess).toBe(false);
    expect(result.current.isPurchasing).toBe(false);
  });

  it('is consumed on a second delivery after the first consume failed', async () => {
    mockFinishTransaction.mockRejectedValueOnce(new Error('service unavailable'));
    const { result } = renderHook(() => useDonation());

    await deliver(tip());
    await deliver(tip());

    expect(mockFinishTransaction).toHaveBeenCalledTimes(2);
    expect(mockRecordAction).toHaveBeenCalledTimes(1);
    expect(result.current.purchaseSuccess).toBe(true);
  });
});

describe('opening the billing connection', () => {
  it('consumes a paid tip the store still holds unconsumed', async () => {
    mockConnected = true;
    mockGetAvailablePurchases.mockResolvedValue([tip()]);

    renderHook(() => useDonation());

    await waitFor(() =>
      expect(mockFinishTransaction).toHaveBeenCalledWith({
        purchase: expect.objectContaining({ productId: 'tip_small', purchaseToken: 'token-1' }),
        isConsumable: true,
      })
    );
    await waitFor(() => expect(mockRecordAction).toHaveBeenCalledTimes(1));
  });

  it('leaves a pending tip and a purchase that is not a tip alone', async () => {
    mockConnected = true;
    mockGetAvailablePurchases.mockResolvedValue([
      tip({ purchaseState: 'pending', purchaseToken: 'token-pending' }),
      tip({ productId: 'other_product', purchaseToken: 'token-other' }),
    ]);

    renderHook(() => useDonation());

    await waitFor(() => expect(mockGetAvailablePurchases).toHaveBeenCalled());
    await act(async () => {});
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(mockRecordAction).not.toHaveBeenCalled();
  });

  it('records nothing when consuming a held tip fails', async () => {
    mockConnected = true;
    mockGetAvailablePurchases.mockResolvedValue([tip()]);
    mockFinishTransaction.mockRejectedValue(new Error('service unavailable'));

    renderHook(() => useDonation());

    await waitFor(() => expect(mockFinishTransaction).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockRecordAction).not.toHaveBeenCalled();
  });

  it('survives the store failing to list what it holds', async () => {
    mockConnected = true;
    mockGetAvailablePurchases.mockRejectedValue(new Error('not connected'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useDonation());

    await waitFor(() => expect(mockGetAvailablePurchases).toHaveBeenCalled());
    await act(async () => {});
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(result.current.purchaseSuccess).toBe(false);
    warn.mockRestore();
  });

  it('does not consume a tip twice when the listener delivers it during the sweep', async () => {
    mockConnected = true;
    let resolveFinish: () => void = () => {};
    mockFinishTransaction.mockImplementation(
      () => new Promise<void>((resolve) => (resolveFinish = resolve))
    );
    mockGetAvailablePurchases.mockResolvedValue([tip()]);

    renderHook(() => useDonation());
    await waitFor(() => expect(mockFinishTransaction).toHaveBeenCalledTimes(1));

    const second = mockOptions!.onPurchaseSuccess(tip());
    await act(async () => {
      resolveFinish();
      await second;
    });

    expect(mockFinishTransaction).toHaveBeenCalledTimes(1);
    expect(mockRecordAction).toHaveBeenCalledTimes(1);
  });
});
