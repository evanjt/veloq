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

// A glyph renders a Text on device, which takes the accessibility props it is
// given, so the icon mock keeps them and a test can tell a hidden glyph from a
// read one.
const ICON_ACCESSIBILITY_PROPS = [
  "accessible",
  "accessibilityElementsHidden",
  "accessibilityLabel",
  "accessibilityRole",
  "importantForAccessibility",
];

function mockIcon(displayName) {
  const Component = React.forwardRef(function MockIcon(props, ref) {
    const forwarded = viewProps(props, "icon");
    for (const key of ICON_ACCESSIBILITY_PROPS) {
      if (props[key] !== undefined) forwarded[key] = props[key];
    }
    return React.createElement(View, { ref, ...forwarded }, props.children);
  });
  Component.displayName = displayName;
  return Component;
}

// The icon set loads its font through expo-font and expo-asset on mount, and
// under Jest the asset registry holds no font, so a mounted icon throws.
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
  const exports = { createIconSet: () => mockIcon("Icon") };
  for (const name of iconSets) {
    exports[name] = mockIcon(name);
  }
  return exports;
});

// The one icon set Paper loads by its own path, for the icons its fields draw.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  __esModule: true,
  default: mockIcon("MaterialCommunityIcons"),
}));

jest.mock("react-native-webview", () => ({
  WebView: mockViewWithHandle("WebView", "webview", () => ({
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
    reload: jest.fn(),
    stopLoading: jest.fn(),
  })),
}));

// In-app purchases reach the graph of anything that touches the `@/shared/app`
// barrel, which `Shimmer` does for `useTheme`, so every suite rendering a
// shimmer loads the native NitroModules binding and fails to start. The stub
// reports a store that is not connected, which is what `useDonation` treats as
// "tipping unavailable".
jest.mock("react-native-iap", () => ({
  useIAP: () => ({
    connected: false,
    products: [],
    fetchProducts: jest.fn().mockResolvedValue(undefined),
    requestPurchase: jest.fn().mockResolvedValue(undefined),
    finishTransaction: jest.fn().mockResolvedValue(undefined),
  }),
  ErrorCode: { UserCancelled: "user-cancelled" },
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
    DashPathEffect: mockView("DashPathEffect", "skia-dash-path-effect"),
    Text: mockView("Text", "skia-text"),
    LinearGradient: mockView("LinearGradient", "skia-linear-gradient"),
    Paint: mockView("Paint", "skia-paint"),
    vec: (x, y) => ({ x, y }),
    Picture: mockView("Picture", "skia-picture"),
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
      // A chart that draws its grid as one recorded picture rather than as
      // nodes still has to record something for the render to complete.
      PictureRecorder: () => ({
        beginRecording: () => ({
          drawRect: jest.fn(),
          drawRRect: jest.fn(),
          drawCircle: jest.fn(),
          drawLine: jest.fn(),
          drawText: jest.fn(),
          drawPath: jest.fn(),
          save: jest.fn(),
          restore: jest.fn(),
          translate: jest.fn(),
          scale: jest.fn(),
          clipRect: jest.fn(),
        }),
        finishRecordingAsPicture: () => ({}),
      }),
      XYWHRect: (x, y, width, height) => ({ x, y, width, height }),
      RRectXY: (rect, rx, ry) => ({ rect, rx, ry }),
      Paint: () => ({
        setColor: jest.fn(),
        setAntiAlias: jest.fn(),
        setStrokeWidth: jest.fn(),
        setAlphaf: jest.fn(),
        setStyle: jest.fn(),
        setStrokeJoin: jest.fn(),
        setStrokeCap: jest.fn(),
      }),
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    ClipOp: { Difference: 0, Intersect: 1 },
    StrokeCap: { Butt: 0, Round: 1, Square: 2 },
    StrokeJoin: { Miter: 0, Round: 1, Bevel: 2 },
    useFont: () => null,
    matchFont: () => null,
  };
});

