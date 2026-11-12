// The same screen in plain React DOM: what the page's own component kit would render.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { COLUMNS, ROWS, TILES, markRendered } from './fixture';

function MeasuredScreen() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <section style={{ display: 'flex', gap: 12 }}>
        {TILES.map(([label, value, unit]) => (
          <div
            key={label}
            style={{
              flex: 1,
              border: '1px solid #ccc',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
            <div style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
              {value} <span style={{ fontSize: 12, color: '#666' }}>{unit}</span>
            </div>
          </div>
        ))}
      </section>
      <section style={{ border: '1px solid #ccc', borderRadius: 8, marginTop: 16 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>This month</h2>
          <span
            style={{
              borderRadius: 999,
              padding: '2px 8px',
              background: '#dde',
            }}
          >
            23
          </span>
          <button type="button">Export</button>
        </header>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={c} style={{ textAlign: i ? 'right' : 'left', padding: 8 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, i) => (
                  <td
                    key={i}
                    style={{
                      textAlign: i ? 'right' : 'left',
                      padding: 8,
                      fontVariantNumeric: 'tabular-nums',
                      borderTop: '1px solid #eee',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root') as HTMLElement).render(<MeasuredScreen />);
markRendered();
