export function validateIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false
  const d = ico.split('').map(Number)
  const sum = d[0] * 8 + d[1] * 7 + d[2] * 6 + d[3] * 5 + d[4] * 4 + d[5] * 3 + d[6] * 2
  const rem = sum % 11
  const check = rem === 0 ? 1 : rem === 1 ? 0 : 11 - rem
  return d[7] === check
}
