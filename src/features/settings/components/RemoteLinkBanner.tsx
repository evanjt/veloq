import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remote, type FfiRemoteWrite } from 'veloqrs';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { useEngineReady } from '@/shared/native/useEngineReady';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { disconnectRemoteLink } from '../lib/remoteLinkSession';

/** How long the banner names a change before it returns to the count. */
const NAMED_FOR_MS = 4_000;

/** The newest change any linked browser made, with the name of the browser that made it. */
function newestRemoteWrite(): { browser: string; write: FfiRemoteWrite } | null {
  let newest: { browser: string; write: FfiRemoteWrite } | null = null;
  for (const device of remote.listLinkedDevices()) {
    const [write] = remote.recentWrites(device.id, 1);
    if (write && (newest === null || write.at > newest.write.at)) {
      newest = { browser: device.name, write };
    }
  }
  return newest;
}

/**
 * Says while a linked browser is reading the library, names each change one
 * makes as it lands, and ends the connection on tap.
 */
export function RemoteLinkBanner() {
  const { t } = useTranslation();
  const connected = useRemoteLinkStatus((state) => state.connected);
  const engine = useEngineReady();
  const [named, setNamed] = useState<string | null>(null);

  useEffect(() => {
    if (!engine) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = engine.subscribe('remoteWrote', () => {
      const newest = newestRemoteWrite();
      if (!newest) return;
      setNamed(t('remoteLink.wrote', { browser: newest.browser, summary: newest.write.summary }));
      clearTimeout(timer);
      timer = setTimeout(() => setNamed(null), NAMED_FOR_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [engine, t]);

  if (connected === 0) return null;

  return (
    <NoticeBanner
      slot="remoteLink"
      tone="info"
      icon="laptop"
      title={named ?? t('remoteLink.connected', { count: connected })}
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
