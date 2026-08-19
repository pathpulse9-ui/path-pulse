export const T = {
  pageTitle: 'text-black text-2xl font-medium leading-tight tracking-[-0.03em]',
  pageDescription: 'text-sm text-black/60 leading-relaxed',

  cardTitle: 'text-black text-lg font-medium tracking-[-0.02em]',
  cardDescription: 'text-sm text-black/60 leading-relaxed',

  metric: 'text-2xl font-medium text-black tracking-[-0.02em]',
  metricHero: 'text-4xl font-medium text-black tracking-[-0.03em]',
  metricLabel: 'text-xs text-black/50',

  body: 'text-sm text-black',
  bodyMuted: 'text-sm text-black/60',
  mono: 'font-mono text-xs',

  tableHeadRow: 'text-left text-black/50 border-b border-black/10',
  tableHeadCell: 'py-2 font-medium',
  tableRow: 'border-b border-black/5',
  tableCell: 'py-2',

  buttonPrimary:
    'bg-black text-white text-sm font-medium px-6 h-10 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50',
  buttonSecondary:
    'rounded-full border border-black/10 bg-white px-5 h-10 text-sm hover:bg-black/5 transition-colors duration-200 disabled:opacity-50',

  card: 'rounded-2xl bg-white p-6',
  cardInner: 'rounded-xl bg-black/[0.03] p-4',
  sectionStack: 'space-y-6',
} as const;
