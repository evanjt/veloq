import { act, renderHook } from '@testing-library/react-native';

import { useCollapsibleSections } from '@/shared/app/useCollapsibleSections';

describe('collapsible section handlers', () => {
  it('keeps a section handler stable while other screen data changes', async () => {
    const { result, rerender } = await renderHook(() =>
      useCollapsibleSections({ performance: false, trends: false })
    );
    const handler = result.current.onToggle('performance');

    await rerender(undefined);
    expect(result.current.onToggle('performance')).toBe(handler);

    await act(() => result.current.onToggle('trends')(true));
    expect(result.current.onToggle('performance')).toBe(handler);
    expect(result.current.expanded('trends')).toBe(true);

    await act(() => handler(true));
    expect(result.current.expanded('performance')).toBe(true);
  });
});
