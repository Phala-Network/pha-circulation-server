// Pure circulation formulas. All amounts are 18-decimal wei values kept as
// bigint until final formatting.

export const DECIMALS = 18

export interface EthereumInputs {
  totalSupply: bigint
  reward: bigint
  sunsetReward: bigint
  phalaChainBridge: bigint
  khalaLegacyChainBridge: bigint
  khalaChainBridge: bigint
  sygmaBridge: bigint
  portalBridge: bigint
  vaultBalance: bigint
  vaultTotalAssets: bigint
  vaultTreasuryAssets: bigint
  vaultUnstakeLocked: bigint
}

export interface BaseInputs {
  totalSupply: bigint
  reward: bigint
  phalaChainBridge: bigint
  khalaLegacyChainBridge: bigint
  khalaChainBridge: bigint
  sygmaBridge: bigint
  portalBridge: bigint
}

export class InvariantError extends Error {
  override name = 'InvariantError'
}

function assertInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new InvariantError(message)
}

// Supply is zero right after a token deployment (Base on 2024-04-05), so only
// negative amounts and amounts above the supply are impossible.
const assertAmounts = (values: Record<string, bigint>, totalSupply: bigint) => {
  assertInvariant(totalSupply >= 0n, 'totalSupply must not be negative')
  for (const [key, value] of Object.entries(values)) {
    assertInvariant(value >= 0n, `${key} must not be negative`)
    assertInvariant(value <= totalSupply, `${key} must not exceed totalSupply`)
  }
}

export const calculateEthereum = (input: EthereumInputs) => {
  const khalaChainBridge = input.khalaChainBridge + input.khalaLegacyChainBridge
  const vaultReward =
    input.vaultBalance -
    input.vaultTotalAssets -
    input.vaultTreasuryAssets -
    input.vaultUnstakeLocked
  const circulation =
    input.totalSupply -
    input.reward -
    input.sunsetReward -
    input.phalaChainBridge -
    khalaChainBridge -
    input.sygmaBridge -
    input.portalBridge -
    vaultReward

  // vaultReward is not checked on its own: it is legitimately negative while
  // promised Vault rewards exceed the funded balance (e.g. November 2025).
  assertAmounts(
    {
      reward: input.reward,
      sunsetReward: input.sunsetReward,
      phalaChainBridge: input.phalaChainBridge,
      khalaChainBridge,
      sygmaBridge: input.sygmaBridge,
      portalBridge: input.portalBridge,
      vaultUnstakeLocked: input.vaultUnstakeLocked,
      circulation,
    },
    input.totalSupply,
  )

  return {
    reward: input.reward,
    sunsetReward: input.sunsetReward,
    phalaChainBridge: input.phalaChainBridge,
    khalaChainBridge,
    sygmaBridge: input.sygmaBridge,
    portalBridge: input.portalBridge,
    totalSupply: input.totalSupply,
    vaultReward,
    vaultUnstakeLocked: input.vaultUnstakeLocked,
    circulation,
  }
}

export const calculateBase = (input: BaseInputs) => {
  const khalaChainBridge = input.khalaChainBridge + input.khalaLegacyChainBridge
  const circulation =
    input.totalSupply -
    input.reward -
    input.phalaChainBridge -
    khalaChainBridge -
    input.sygmaBridge -
    input.portalBridge

  assertAmounts(
    {
      reward: input.reward,
      phalaChainBridge: input.phalaChainBridge,
      khalaChainBridge,
      sygmaBridge: input.sygmaBridge,
      portalBridge: input.portalBridge,
      circulation,
    },
    input.totalSupply,
  )

  return {
    reward: input.reward,
    phalaChainBridge: input.phalaChainBridge,
    khalaChainBridge,
    sygmaBridge: input.sygmaBridge,
    portalBridge: input.portalBridge,
    totalSupply: input.totalSupply,
    circulation,
  }
}

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

// Previous behavior: Decimal(ethereum).plus(base).toDP(12, ROUND_DOWN).
export const TOTAL_CIRCULATION_DECIMALS = 12

export const formatTotalCirculation = (ethereum: bigint, base: bigint) => {
  const step = 10n ** BigInt(DECIMALS - TOTAL_CIRCULATION_DECIMALS)
  // bigint division truncates toward zero, matching ROUND_DOWN.
  const truncated = ((ethereum + base) / step) * step
  return formatAmount(truncated)
}
