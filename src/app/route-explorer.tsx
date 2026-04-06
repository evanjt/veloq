import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/theme';

export default function RouteExplorerRedirect() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  useEffect(() => {
    router.replace({
      pathname: '/routes',
      params: tab ? { tab } : undefined,
    });
  }, [tab]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
