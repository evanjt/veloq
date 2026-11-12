// The two things of react-native that the app's formatting module reads, for
// the page. The build resolves `react-native` to this file for that module and
// no other, so an import of the real package anywhere else still fails the
// build.

export const AppState = {
  addEventListener: (_type: 'change', _listener: (state: string) => void) => ({
    remove: () => {},
  }),
};

export const I18nManager = { isRTL: false };
