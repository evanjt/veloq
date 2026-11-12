// The same screen through the app's own components on react-native-web.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { Card } from '@/shared/ui/Card';
import { CardHeader } from '@/shared/ui/CardHeader';
import { Button } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Badge';
import { DataTable } from '@/shared/ui/DataTable';
import { StatTile } from '@/shared/ui/StatTile';
import { COLUMNS, ROWS, TILES, markRendered } from './fixture';

function MeasuredScreen() {
  return (
    <View style={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {TILES.map(([label, value, unit]) => (
          <Card key={label} variant="raised" style={{ flex: 1 }}>
            <StatTile label={label} value={value} unit={unit || undefined} />
          </Card>
        ))}
      </View>
      <View style={{ height: 16 }} />
      <Card variant="raised" padding="none">
        <CardHeader
          title="This month"
          accessory={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Badge tone="count" text={23} isDark={false} />
              <Button label="Export" variant="secondary" size="sm" onPress={() => {}} />
            </View>
          }
        />
        <DataTable columns={COLUMNS} rows={ROWS} />
      </Card>
    </View>
  );
}
createRoot(document.getElementById('root') as HTMLElement).render(<MeasuredScreen />);
markRendered();
