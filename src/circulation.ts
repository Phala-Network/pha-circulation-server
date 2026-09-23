import type {PublicClient} from 'viem'
import {
  calculateBase,
  calculateEthereum,
  formatAmount,
  formatTotalCirculation,
} from './calc.js'
import {
  type BlockId,
  createClient,
  getBlockRef,
  readBaseInputs,
  readEthereumInputs,
} from './chain.js'
import type {Config} from './config.js'
import {fetchIndexedVaultState} from './goldsky.js'

export class StaleDataError extends Error {
  override name = 'StaleDataError'
}

export interface Clients {
  ethereum: PublicClient
  base: PublicClient
}

export const createClients = (config: Config): Clients => ({
  ethereum: createClient(config.ethereumRpcUrl, config.timeoutMs),
  base: createClient(config.baseRpcUrl, config.timeoutMs),
})

export const goldskyConfig = (config: Config) => ({
  url: config.goldskyUrl,
  token: config.goldskyToken,
  timeoutMs: config.timeoutMs,
})

// Block timestamps in the legacy squid format: whole seconds written with
// microsecond precision.
export const formatTimestamp = (seconds: bigint) =>
  `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.000000Z`

export const readEthereum = async (
  client: PublicClient,
  block: BlockId,
  vaultUnstakeLocked: bigint,
) =>
  calculateEthereum(await readEthereumInputs(client, block, vaultUnstakeLocked))

export const readBase = async (client: PublicClient, block: BlockId) =>
  calculateBase(await readBaseInputs(client, block))

type Ethereum = Awaited<ReturnType<typeof readEthereum>>
type Base = Awaited<ReturnType<typeof readBase>>

export const formatEthereum = (ethereum: Ethereum) => ({
  circulation: formatAmount(ethereum.circulation),
  totalSupply: formatAmount(ethereum.totalSupply),
  reward: formatAmount(ethereum.reward),
  sunsetReward: formatAmount(ethereum.sunsetReward),
  phalaChainBridge: formatAmount(ethereum.phalaChainBridge),
  khalaChainBridge: formatAmount(ethereum.khalaChainBridge),
  sygmaBridge: formatAmount(ethereum.sygmaBridge),
  portalBridge: formatAmount(ethereum.portalBridge),
  vaultReward: formatAmount(ethereum.vaultReward),
  vaultUnstakeLocked: formatAmount(ethereum.vaultUnstakeLocked),
})

export const formatBase = (base: Base) => ({
  circulation: formatAmount(base.circulation),
  totalSupply: formatAmount(base.totalSupply),
})

const zeroSubstrateChain = () => ({
  circulation: '0',
  crowdloan: '0',
  reward: '0',
  sygmaBridge: '0',
  timestamp: new Date().toISOString(),
  totalIssuance: '0',
})

// Latest circulation: Ethereum at the block Goldsky has indexed, Base at its
// finalized block. Keeps the legacy /api/all response shape.
export const getAllData = async (config: Config) => {
  const clients = createClients(config)
  const [vaultState, ethereumHead, baseBlock] = await Promise.all([
    fetchIndexedVaultState(goldskyConfig(config)),
    getBlockRef(clients.ethereum, {blockTag: 'latest'}),
    getBlockRef(clients.base, {blockTag: 'finalized'}),
  ])

  const indexed = vaultState.indexedBlock
  const lagBlocks =
    ethereumHead.number > indexed.number
      ? ethereumHead.number - indexed.number
      : 0n
  if (lagBlocks > config.maxEthereumLagBlocks) {
    throw new StaleDataError(
      `Goldsky is ${lagBlocks} blocks behind Ethereum head ${ethereumHead.number}`,
    )
  }

  // Reads use Goldsky's block hash and require it to be canonical, so they
  // fail instead of mixing chain states during a reorg.
  const [ethereumBlock, ethereum, base] = await Promise.all([
    getBlockRef(clients.ethereum, {blockHash: indexed.hash}),
    readEthereum(clients.ethereum, indexed, vaultState.vaultUnstakeLocked),
    readBase(clients.base, baseBlock),
  ])
  if (ethereumBlock.number !== indexed.number) {
    throw new StaleDataError(
      `Goldsky block ${indexed.number} hash resolves to ${ethereumBlock.number}`,
    )
  }

  const ethereumAmounts = formatEthereum(ethereum)
  const baseAmounts = formatBase(base)
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
      timestamp: formatTimestamp(ethereumBlock.timestamp),
      totalSupply: ethereumAmounts.totalSupply,
      vaultReward: ethereumAmounts.vaultReward,
    },
    base: {
      circulation: baseAmounts.circulation,
      totalSupply: baseAmounts.totalSupply,
      timestamp: formatTimestamp(baseBlock.timestamp),
    },
    totalCirculation: formatTotalCirculation(
      ethereum.circulation,
      base.circulation,
    ),
    sources: {
      ethereum: {
        blockNumber: indexed.number.toString(),
        headBlockNumber: ethereumHead.number.toString(),
        lagBlocks: lagBlocks.toString(),
        vaultUnstakeLocked: ethereumAmounts.vaultUnstakeLocked,
      },
      base: {blockNumber: baseBlock.number.toString(), blockTag: 'finalized'},
    },
  }
}
