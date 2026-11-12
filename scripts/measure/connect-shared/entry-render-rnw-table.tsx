// The table alone through react-native-web, to separate its cost from the controls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { COLUMNS, ROWS, markRendered } from './fixture';
createRoot(document.getElementById('root') as HTMLElement).render(
  <View style={{ padding: 16 }}>
    <Card variant="raised" padding="none">
      <DataTable columns={COLUMNS} rows={ROWS} />
    </Card>
  </View>
);
markRendered();
