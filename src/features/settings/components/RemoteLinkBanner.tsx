import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { disconnectRemoteLink } from '../lib/remoteLinkSession';

/** Says while a linked browser is reading the library, and ends it on tap. */
export function RemoteLinkBanner() {
  const { t } = useTranslation();
  const connected = useRemoteLinkStatus((state) => state.connected);
  if (connected === 0) return null;

  return (
    <NoticeBanner
      slot="remoteLink"
      tone="info"
      icon="laptop"
      title={t('remoteLink.connected', { count: connected })}
      actions={[
        {
          label: t('remoteLink.disconnect'),
          onPress: disconnectRemoteLink,
          testID: 'remote-link-disconnect',
        },
      ]}
      testID="remote-link-banner"
    />
  );
}
