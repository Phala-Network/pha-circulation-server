import {formatAmount, formatTotalCirculation} from './calc.js'
import type {Config} from './config.js'
import {type ChainState, readSubgraph, SubgraphError} from './subgraph.js'

// Block timestamps in the legacy squid format: whole seconds written with
// microsecond precision.
export const formatTimestamp = (seconds: bigint) =>
  `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.000000Z`

export const formatEthereum = (ethereum: ChainState) => ({
  circulation: formatAmount(ethereum.circulation),
  totalSupply: formatAmount(ethereum.totalSupply),
  reward: formatAmount(ethereum.reward),
  sunsetReward: formatAmount(ethereum.sunsetReward),
  phalaChainBridge: formatAmount(ethereum.phalaChainBridge),
  khalaChainBridge: formatAmount(
    ethereum.khalaChainBridge + ethereum.khalaLegacyChainBridge,
  ),
  sygmaBridge: formatAmount(ethereum.sygmaBridge),
  portalBridge: formatAmount(ethereum.portalBridge),
  vaultReward: formatAmount(ethereum.vaultReward),
  vaultUnstakeLocked: formatAmount(ethereum.vaultUnstakeLocked),
})

const zeroSubstrateChain = () => ({
  circulation: '0',
  crowdloan: '0',
  reward: '0',
  sygmaBridge: '0',
  timestamp: new Date().toISOString(),
  totalIssuance: '0',
})

// Portal escrow stays in Ethereum circulation; Base has no separate state.
export const getAllData = async (config: Config) => {
  const ethSource = await readSubgraph(config)
  const ethereum = ethSource.state
  if (!ethereum) throw new SubgraphError('Missing Latest state')
  const ethereumAmounts = formatEthereum(ethereum)
  return {
    phala: zeroSubstrateChain(),
    khala: zeroSubstrateChain(),
    ethereum: {
      circulation: ethereumAmounts.circulation,
      phalaChainBridge: ethereumAmounts.phalaChainBridge,
      khalaChainBridge: ethereumAmounts.khalaChainBridge,
      reward: ethereumAmounts.reward,
      sygmaBridge: ethereumAmounts.sygmaBridge,
      portalBridge: ethereumAmounts.portalBridge,
      timestamp: formatTimestamp(ethereum.timestamp),
      totalSupply: ethereumAmounts.totalSupply,
      vaultReward: ethereumAmounts.vaultReward,
    },
    base: null,
    totalCirculation: formatTotalCirculation(ethereum.circulation),
    sources: {
      ethereum: {
        blockNumber: ethereum.observedBlockNumber.toString(),
        indexedAt: formatTimestamp(ethSource.indexedAt),
        lagSeconds: ethSource.lagSeconds.toString(),
        vaultUnstakeLocked: ethereumAmounts.vaultUnstakeLocked,
      },
      base: null,
    },
  }
}
