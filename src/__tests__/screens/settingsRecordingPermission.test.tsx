/**
 * Scenario: an OAuth athlete whose token predates the write scope cannot upload
 * a recording. The only prompt was a dismissible banner on the recordings
 * screen, so once dismissed there was nowhere to grant access from.
 *
 * Expected behaviour: Settings carries a Recording group with a Grant Access
 * control whenever an OAuth athlete has no confirmed write permission, and
 * carries nothing when the permission is confirmed or the athlete signed in
 * with an API key.
 */

import React from "react";
import { render } from "@testing-library/react-native";

import SettingsScreen from "@/app/settings";
import { useAuthStore } from "@/shared/app/AuthStore";
import { useUploadPermissionStore } from "@/features/recording/stores/UploadPermissionStore";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock("@/shared/app/TopSafeAreaContext", () => ({
  ...jest.requireActual("@/shared/app/TopSafeAreaContext"),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock("react-native-iap", () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock("@/features/maps/stores/MapPreferencesContext", () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: "outdoors", terrain3DMode: "off" },
  }),
}));

jest.mock("@/shared/app/useAthlete", () => ({
  useAthlete: () => ({ athlete: null }),
}));

jest.mock("@/shared/storage/gpsStorage", () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock("@/features/settings/lib/autobackup", () => ({
  getLastBackupTimestamp: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/features/settings/components", () => ({
  SupportSection: () => null,
  FooterSection: () => null,
}));

const mockUpgradePermissions = jest.fn();
jest.mock("@/features/recording/hooks/usePermissionUpgrade", () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: mockUpgradePermissions,
    isUpgrading: false,
    error: null,
  }),
}));

function signIn(authMethod: "oauth" | "apiKey" | "demo") {
  useAuthStore.setState({ authMethod });
}

describe("Settings recording permission", () => {
  beforeEach(() => {
    useUploadPermissionStore.setState({ hasWritePermission: null });
    signIn("oauth");
  });

  it("offers Grant Access when an OAuth token has no confirmed write permission", () => {
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-grant-access")).toBeTruthy();
  });

  it("offers Grant Access when the write scope was explicitly refused", () => {
    useUploadPermissionStore.setState({ hasWritePermission: false });
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId("settings-grant-access")).toBeTruthy();
  });

  it("says nothing once the write permission is confirmed", () => {
    useUploadPermissionStore.setState({ hasWritePermission: true });
    const { queryByTestId } = render(<SettingsScreen />);
    expect(queryByTestId("settings-grant-access")).toBeNull();
  });

  it.each(["apiKey", "demo"] as const)(
    "says nothing for a %s sign-in",
    (authMethod) => {
      signIn(authMethod);
      const { queryByTestId } = render(<SettingsScreen />);
      expect(queryByTestId("settings-grant-access")).toBeNull();
    },
  );
});
