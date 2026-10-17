export const MAX_SIGNIFICANT_DIGITS = 12;

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Error';
  if (value === 0) return '0';

  const s = value.toPrecision(MAX_SIGNIFICANT_DIGITS);

  const eIndex = s.indexOf('e');
  const mantissa = eIndex === -1 ? s : s.slice(0, eIndex);
  const exponent = eIndex === -1 ? '' : s.slice(eIndex);

  let m = mantissa;
  if (m.includes('.')) {
    m = m.replace(/0+$/, '').replace(/\.$/, '');
  }

  return m + exponent;
}
