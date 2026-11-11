import React from 'react';
import { useTranslation } from 'react-i18next';
import { parseNextcloudLogin, type NextcloudLogin } from '../lib/autobackup/nextcloudLogin';
import { QrScanner } from './QrScanner';

interface NextcloudQrScannerProps {
  /** Called once, with the first code that reads as a Nextcloud login. */
  onScanned: (login: NextcloudLogin) => void;
  onClose: () => void;
  /** Closes the scanner for the typed fields, which need no camera. */
  onEnterDetails: () => void;
}

export function NextcloudQrScanner({
  onScanned,
  onClose,
  onEnterDetails,
}: NextcloudQrScannerProps) {
  const { t } = useTranslation();
  const read = (data: string) => {
    const login = parseNextcloudLogin(data);
    if (login) onScanned(login);
    return login !== null;
  };
  return (
    <QrScanner
      read={read}
      title={t('backup.scanQrTitle', 'Scan Nextcloud QR code')}
      instructions={t(
        'backup.scanQrInstructions',
        'In Nextcloud, go to Settings → Security → Create new app password, then scan the QR code shown.'
      )}
      mismatch={t('backup.invalidQrCode', 'Not a valid Nextcloud QR code')}
      onClose={onClose}
      onEnterDetails={onEnterDetails}
      testID="nextcloud-scanner-camera"
    />
  );
}
