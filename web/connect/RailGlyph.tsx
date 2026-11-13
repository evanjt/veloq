// The rail's glyphs: one 24-unit outline per screen, drawn as inline SVG in the
// current text colour so the page's content-security policy needs no font. A
// selected entry fills its shape, as the phone's tab bar does.

export type RailIcon = 'feed' | 'fitness' | 'insights' | 'map' | 'routes' | 'sections' | 'settings';

const SHAPES: Record<RailIcon, string[]> = {
  feed: ['M4 11 12 4l8 7v9h-5v-6H9v6H4z'],
  fitness: ['M4 4h16v16H4z', 'M8 16v-5', 'M12 16V8', 'M16 16v-3'],
  insights: [
    'M9 18h6',
    'M10 21h4',
    'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  ],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
  routes: [
    'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  ],
  sections: ['M4 12h4', 'M16 12h4', 'M8 12h8', 'M8 8v8', 'M16 8v8'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  ],
};

export function RailGlyph({ icon, selected }: { icon: RailIcon; selected: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill={selected && (icon === 'feed' || icon === 'map') ? 'currentColor' : 'none'}
      fillOpacity={0.2}
      stroke="currentColor"
      strokeWidth={selected ? 2 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
