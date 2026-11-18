// Which files may read which token family on the connect page. A role colour is meaningful by
// where it is read: gold marks a record, the direction pair marks a section's two directions,
// and the retired chart and line aliases name a series by position, not by what it is.

const ROLES = [
  {
    family: /--(colour|role)-(achievement|personalRecord)\b/g,
    readers: [
      /^web\/connect\/charts\/colours\.ts$/,
      /^web\/connect\/pages\/(RouteDetail|SectionParts|SectionDetailPage)\.tsx$/,
      /^web\/connect\/ui\//,
    ],
    why: 'gold is read by the records only',
  },
  {
    family: /--colour-direction-(forward|reverse)\b/g,
    readers: [
      /^web\/connect\/charts\/colours\.ts$/,
      /^web\/connect\/pages\/Section[A-Za-z]*\.tsx$/,
    ],
    why: 'the direction pair is read by the section views only',
  },
  {
    family: /--colour-wellness-(hrv|rhr)\b/g,
    readers: [/^web\/connect\/charts\/colours\.ts$/],
    why: 'wellness colours are read through charts/colours.ts',
  },
  {
    family: /--(chart-[a-z]|line-\d)\b/g,
    readers: [],
    why: 'the chart and line aliases are retired; read a token through charts/colours.ts',
  },
];

/** The reads a file may not make, as `file:line --property reason`. `files` maps path to text. */
export function checkChartColourRoles(files) {
  const failures = [];
  for (const [file, text] of files) {
    if (/tokens\.generated\./.test(file) || /(^|\/)__tests__\//.test(file)) continue;
    for (const { family, readers, why } of ROLES) {
      if (readers.some((reader) => reader.test(file))) continue;
      for (const match of text.matchAll(family)) {
        const line = text.slice(0, match.index).split('\n').length;
        failures.push(`${file}:${line} ${match[0]} ${why}`);
      }
    }
  }
  return failures;
}
