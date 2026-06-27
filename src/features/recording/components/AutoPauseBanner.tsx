import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { styles } from '../RecordingScreen.styles';

export function AutoPauseBanner({ autoPaused }: { autoPaused: boolean }) {
  const { t } = useTranslation();
  if (!autoPaused) return null;
  return (
    <View style={styles.autoPauseBanner}>
      <View style={styles.autoPauseDot} />
      <Text style={styles.autoPauseText}>
        {t('recording.autoPaused')} — {t('recording.autoPausedHint')}
      </Text>
    </View>
  );
}
