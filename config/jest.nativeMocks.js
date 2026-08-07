// Mocks for the three packages that need a native surface: WebView, Skia and
// Victory. Each renders as a plain View that keeps its children and its
// callbacks, so a render test can walk the tree and fire events without a GL
// context.
//
// Keep these free of renderer-specific behaviour. A component test built on
// them has to stay valid if the implementation changes underneath.

const React = require("react");
const { View } = require("react-native");

// Style props on a map surface are MapLibre style objects, not React Native
// styles, so only callbacks and the testID are forwarded to the View.
function viewProps(props, fallbackTestID) {
  const forwarded = { testID: props.testID ?? fallbackTestID };
  for (const key of Object.keys(props)) {
    if (key.startsWith("on") && typeof props[key] === "function") {
      forwarded[key] = props[key];
    }
  }
  return forwarded;
}

function mockView(displayName, fallbackTestID) {
  const Component = React.forwardRef(function MockNativeView(props, ref) {
    return React.createElement(
      View,
      { ref, ...viewProps(props, fallbackTestID) },
      props.children,
    );
  });
  Component.displayName = displayName;
  return Component;
}

// Components whose ref is called imperatively need a handle, otherwise the
// first camera move throws on a plain View ref.
function mockViewWithHandle(displayName, fallbackTestID, buildHandle) {
  const Component = React.forwardRef(function MockNativeView(props, ref) {
    React.useImperativeHandle(ref, buildHandle, []);
    return React.createElement(
      View,
      { ...viewProps(props, fallbackTestID) },
      props.children,
    );
  });
  Component.displayName = displayName;
  return Component;
}

// The icon set pulls in expo-font, which resolves expo-asset at import time.
// expo-asset is not installed, so importing any icon breaks the module graph
// before a component even renders.
jest.mock("@expo/vector-icons", () => {
  const iconSets = [
    "AntDesign",
    "Entypo",
    "EvilIcons",
    "Feather",
    "FontAwesome",
    "FontAwesome5",
    "FontAwesome6",
    "Fontisto",
    "Foundation",
    "Ionicons",
    "MaterialCommunityIcons",
    "MaterialIcons",
    "Octicons",
    "SimpleLineIcons",
    "Zocial",
  ];
  const exports = { createIconSet: () => mockView("Icon", "icon") };
  for (const name of iconSets) {
    exports[name] = mockView(name, "icon");
  }
  return exports;
});

jest.mock("react-native-webview", () => ({
  WebView: mockViewWithHandle("WebView", "webview", () => ({
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
    reload: jest.fn(),
    stopLoading: jest.fn(),
  })),
}));

jest.mock("@shopify/react-native-skia", () => {
  const Canvas = mockView("Canvas", "skia-canvas");
  return {
    Canvas,
    Group: mockView("Group", "skia-group"),
    Path: mockView("Path", "skia-path"),
    Circle: mockView("Circle", "skia-circle"),
    Rect: mockView("Rect", "skia-rect"),
    RoundedRect: mockView("RoundedRect", "skia-rounded-rect"),
    Line: mockView("Line", "skia-line"),
    Text: mockView("Text", "skia-text"),
    LinearGradient: mockView("LinearGradient", "skia-linear-gradient"),
    Paint: mockView("Paint", "skia-paint"),
    vec: (x, y) => ({ x, y }),
    Skia: {
      Path: {
        Make: () => ({
          moveTo: jest.fn(),
          lineTo: jest.fn(),
          close: jest.fn(),
          toSVGString: () => "",
        }),
        MakeFromSVGString: () => null,
      },
      Color: (value) => value,
    },
    useFont: () => null,
    matchFont: () => null,
  };
});

jest.mock("victory-native", () => ({
  CartesianChart: mockView("CartesianChart", "victory-cartesian-chart"),
  Line: mockView("Line", "victory-line"),
  Area: mockView("Area", "victory-area"),
  Bar: mockView("Bar", "victory-bar"),
  Scatter: mockView("Scatter", "victory-scatter"),
  StackedBar: mockView("StackedBar", "victory-stacked-bar"),
  Pie: mockView("Pie", "victory-pie"),
  PolarChart: mockView("PolarChart", "victory-polar-chart"),
  useChartPressState: () => ({
    state: {
      x: { value: { value: 0 }, position: { value: 0 } },
      y: {},
    },
    isActive: false,
  }),
  useLinePath: () => ({ path: { toSVGString: () => "" } }),
  useAreaPath: () => ({ path: { toSVGString: () => "" } }),
}));
