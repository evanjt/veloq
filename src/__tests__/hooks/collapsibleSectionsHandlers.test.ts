import { act, renderHook } from '@testing-library/react-native';

import { useCollapsibleSections } from '@/shared/app/useCollapsibleSections';

describe('collapsible section handlers', () => {
  it('keeps a section handler stable while other screen data changes', () => {
    const { result, rerender } = renderHook(() =>
      useCollapsibleSections({ performance: false, trends: false })
    );
    const handler = result.current.onToggle('performance');

    rerender(undefined);
    expect(result.current.onToggle('performance')).toBe(handler);

    act(() => result.current.onToggle('trends')(true));
    expect(result.current.onToggle('performance')).toBe(handler);
    expect(result.current.expanded('trends')).toBe(true);

    act(() => handler(true));
    expect(result.current.expanded('performance')).toBe(true);
  });
});
