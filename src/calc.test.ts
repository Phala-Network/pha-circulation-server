import {describe, expect, test} from 'bun:test'
import {formatAmount, formatTotalCirculation} from './calc.js'

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
