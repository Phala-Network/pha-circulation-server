// PHA formatting. Amounts stay as 18-decimal integer wei until serialization.

export const DECIMALS = 18

// Formats a wei amount as a plain decimal string without trailing zeros,
// matching the BigDecimal strings served by the previous GraphQL services.
export const formatAmount = (value: bigint, decimals = DECIMALS): string => {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const integer = abs / base
  const fraction = (abs % base)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

// Preserve the plain-number API precision: 12 decimals, rounded down.
export const TOTAL_CIRCULATION_DECIMALS = 12

export const formatTotalCirculation = (circulation: bigint) => {
  const step = 10n ** BigInt(DECIMALS - TOTAL_CIRCULATION_DECIMALS)
  // bigint division truncates toward zero, matching ROUND_DOWN.
  const truncated = (circulation / step) * step
  return formatAmount(truncated)
}
