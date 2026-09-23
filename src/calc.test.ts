import {describe, expect, test} from 'bun:test'
import {
  InvariantError,
  calculateBase,
  calculateEthereum,
  formatAmount,
  formatTotalCirculation,
} from './calc'

// On-chain inputs at Ethereum block 25390163, the last row written by the
// legacy ethereum-pha-circulation squid.
const ethereumAt25390163 = {
  totalSupply: 1_000_000_000_000000000000000000n,
  reward: 0n,
  sunsetReward: 155_512_138_193661099221466467n,
  phalaChainBridge: 0n,
  khalaLegacyChainBridge: 0n,
  khalaChainBridge: 0n,
  sygmaBridge: 0n,
  portalBridge: 1_137_012_802214700000000000n,
  vaultUnstakeLocked: 48_383_275_952282417636691459n,
  // Only the difference of the Vault values matters for the formula.
  vaultBalance: 52_330_755_449855036153735227n,
  vaultTotalAssets: 0n,
  vaultTreasuryAssets: 0n,
}

describe('calculateEthereum', () => {
  test('matches the legacy row at block 25390163', () => {
    const result = calculateEthereum(ethereumAt25390163)
    expect(formatAmount(result.vaultReward)).toBe('3947479.497572618517043768')
    expect(formatAmount(result.circulation)).toBe(
      '839403369.506551582261489765',
    )
  })

  test('sums both Khala bridges', () => {
    const result = calculateEthereum({
      ...ethereumAt25390163,
      khalaLegacyChainBridge: 2n,
      khalaChainBridge: 3n,
    })
    expect(result.khalaChainBridge).toBe(5n)
  })

  test('allows a negative vaultReward when the Vault is underfunded', () => {
    const result = calculateEthereum({
      ...ethereumAt25390163,
      vaultBalance: 0n,
    })
    expect(result.vaultReward).toBe(-ethereumAt25390163.vaultUnstakeLocked)
    expect(result.circulation).toBeLessThan(ethereumAt25390163.totalSupply)
  })

  test('rejects a negative vaultUnstakeLocked', () => {
    expect(() =>
      calculateEthereum({...ethereumAt25390163, vaultUnstakeLocked: -1n}),
    ).toThrow(InvariantError)
  })

  test('rejects circulation above totalSupply', () => {
    expect(() =>
      calculateEthereum({
        ...ethereumAt25390163,
        vaultBalance: 0n,
        vaultUnstakeLocked: 0n,
        vaultTotalAssets: 200_000_000_000000000000000000n,
      }),
    ).toThrow(InvariantError)
  })
})

describe('calculateBase', () => {
  test('equals totalSupply when excluded holders are empty', () => {
    const result = calculateBase({
      totalSupply: 1_092_890_986267590000000000n,
      reward: 0n,
      phalaChainBridge: 0n,
      khalaLegacyChainBridge: 0n,
      khalaChainBridge: 0n,
      sygmaBridge: 0n,
      portalBridge: 0n,
    })
    expect(formatAmount(result.circulation)).toBe('1092890.98626759')
  })

  test('accepts a zero supply right after deployment', () => {
    const result = calculateBase({
      totalSupply: 0n,
      reward: 0n,
      phalaChainBridge: 0n,
      khalaLegacyChainBridge: 0n,
      khalaChainBridge: 0n,
      sygmaBridge: 0n,
      portalBridge: 0n,
    })
    expect(result.circulation).toBe(0n)
  })

  test('rejects exclusions larger than totalSupply', () => {
    expect(() =>
      calculateBase({
        totalSupply: 10n,
        reward: 11n,
        phalaChainBridge: 0n,
        khalaLegacyChainBridge: 0n,
        khalaChainBridge: 0n,
        sygmaBridge: 0n,
        portalBridge: 0n,
      }),
    ).toThrow(InvariantError)
  })
})

describe('formatting', () => {
  test('strips trailing zeros like the legacy BigDecimal strings', () => {
    expect(formatAmount(0n)).toBe('0')
    expect(formatAmount(1_000_000_000_000000000000000000n)).toBe('1000000000')
    expect(formatAmount(1_137_012_802214700000000000n)).toBe('1137012.8022147')
    expect(formatAmount(1n)).toBe('0.000000000000000001')
    expect(formatAmount(-1_500000000000000000n)).toBe('-1.5')
  })

  test('truncates totalCirculation to 12 decimals', () => {
    // Legacy: 839403369.506551582261489765 + 1092890.98626759
    expect(
      formatTotalCirculation(
        839_403_369_506551582261489765n,
        1_092_890_986267590000000000n,
      ),
    ).toBe('840496260.492819172261')
  })
})
