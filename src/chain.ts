import {
  http,
  type Address,
  type Hash,
  type PublicClient,
  createPublicClient,
  erc20Abi,
  parseAbi,
} from 'viem'
import type {BaseInputs, EthereumInputs} from './calc.js'

export const ETHEREUM_PHA: Address =
  '0x6c5bA91642F10282b576d91922Ae6448C9d52f4E'
export const BASE_PHA: Address = '0x336C9297AFB7798c292E9f80d8e566b947f291f0'
export const VAULT: Address = '0x21d6eC8fc14CaAcc55aFA23cBa66798DAB3a0ec0'

// Deployment blocks. The legacy squids started at the token deployments, and
// read the Vault only from its deployment on.
export const ETHEREUM_PHA_DEPLOYED_AT = 9_975_568n // 2020-04-30 18:36 UTC
export const BASE_PHA_DEPLOYED_AT = 12_743_284n // 2024-04-05 00:11 UTC
export const VAULT_DEPLOYED_AT = 21_596_326n // 2025-01-10 20:00 UTC

// Excluded holders, identical to the archived circulation squids.
export const EXCLUDED = {
  reward: '0x4731bc41b3cca4c2883b8ebb68cb546d5b3b4dd6',
  phalaChainBridge: '0xcd38b15a419491c7c1238b0659f65c755792e257',
  khalaLegacyChainBridge: '0x6ed3bc069cf4f87de05c04c352e8356492ec6efe',
  khalaChainBridge: '0xeec0fb4913119567cdfc0c5fc2bf8f9f9b226c2d',
  sygmaBridge: '0xC832588193cd5ED2185daDA4A531e0B26eC5B830',
  portalBridge: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585',
} as const satisfies Record<string, Address>

export const ETHEREUM_SUNSET_REWARD: Address =
  '0x4A396b5C9a6fBc1Bc0525f24Ac0A246766F3EBEF'

const vaultAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function treasuryAssets() view returns (uint256)',
])

export interface BlockId {
  number: bigint
  hash: Hash
}

export interface BlockRef extends BlockId {
  timestamp: bigint
}

export const createClient = (url: string, timeoutMs: number): PublicClient =>
  createPublicClient({
    transport: http(url, {timeout: timeoutMs, retryCount: 0}),
  })

export const getBlockRef = async (
  client: PublicClient,
  block:
    | {blockNumber: bigint}
    | {blockHash: Hash}
    | {blockTag: 'latest' | 'safe' | 'finalized'},
): Promise<BlockRef> => {
  const {number, hash, timestamp} = await client.getBlock(block)
  if (number == null || hash == null) {
    throw new Error('RPC returned a pending block')
  }
  return {number, hash, timestamp}
}

const balanceOf = (token: Address, holder: Address) =>
  ({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  }) as const

const totalSupply = (token: Address) =>
  ({address: token, abi: erc20Abi, functionName: 'totalSupply'}) as const

// Reads happen at exactly the given block (EIP-1898 block hash, canonical
// only). Deployless multicall does not depend on Multicall3 being deployed,
// which it was not on Ethereum before March 2022.
const readAt = (block: BlockId) =>
  ({
    allowFailure: false,
    blockHash: block.hash,
    requireCanonical: true,
    deployless: true,
  }) as const

// Before the Vault deployment its balance and assets are zero, as in the
// legacy squid.
const readVault = async (client: PublicClient, block: BlockId) =>
  block.number < VAULT_DEPLOYED_AT
    ? ([0n, 0n, 0n] as const)
    : client.multicall({
        ...readAt(block),
        contracts: [
          balanceOf(ETHEREUM_PHA, VAULT),
          {address: VAULT, abi: vaultAbi, functionName: 'totalAssets'},
          {address: VAULT, abi: vaultAbi, functionName: 'treasuryAssets'},
        ],
      })

export const readEthereumInputs = async (
  client: PublicClient,
  block: BlockId,
  vaultUnstakeLocked: bigint,
): Promise<EthereumInputs> => {
  const [
    [
      supply,
      reward,
      sunsetReward,
      phalaChainBridge,
      khalaLegacyChainBridge,
      khalaChainBridge,
      sygmaBridge,
      portalBridge,
    ],
    [vaultBalance, vaultTotalAssets, vaultTreasuryAssets],
  ] = await Promise.all([
    client.multicall({
      ...readAt(block),
      contracts: [
        totalSupply(ETHEREUM_PHA),
        balanceOf(ETHEREUM_PHA, EXCLUDED.reward),
        balanceOf(ETHEREUM_PHA, ETHEREUM_SUNSET_REWARD),
        balanceOf(ETHEREUM_PHA, EXCLUDED.phalaChainBridge),
        balanceOf(ETHEREUM_PHA, EXCLUDED.khalaLegacyChainBridge),
        balanceOf(ETHEREUM_PHA, EXCLUDED.khalaChainBridge),
        balanceOf(ETHEREUM_PHA, EXCLUDED.sygmaBridge),
        balanceOf(ETHEREUM_PHA, EXCLUDED.portalBridge),
      ],
    }),
    readVault(client, block),
  ])
  return {
    totalSupply: supply,
    reward,
    sunsetReward,
    phalaChainBridge,
    khalaLegacyChainBridge,
    khalaChainBridge,
    sygmaBridge,
    portalBridge,
    vaultBalance,
    vaultTotalAssets,
    vaultTreasuryAssets,
    vaultUnstakeLocked,
  }
}

export const readBaseInputs = async (
  client: PublicClient,
  block: BlockId,
): Promise<BaseInputs> => {
  const [
    supply,
    reward,
    phalaChainBridge,
    khalaLegacyChainBridge,
    khalaChainBridge,
    sygmaBridge,
    portalBridge,
  ] = await client.multicall({
    ...readAt(block),
    contracts: [
      totalSupply(BASE_PHA),
      balanceOf(BASE_PHA, EXCLUDED.reward),
      balanceOf(BASE_PHA, EXCLUDED.phalaChainBridge),
      balanceOf(BASE_PHA, EXCLUDED.khalaLegacyChainBridge),
      balanceOf(BASE_PHA, EXCLUDED.khalaChainBridge),
      balanceOf(BASE_PHA, EXCLUDED.sygmaBridge),
      balanceOf(BASE_PHA, EXCLUDED.portalBridge),
    ],
  })
  return {
    totalSupply: supply,
    reward,
    phalaChainBridge,
    khalaLegacyChainBridge,
    khalaChainBridge,
    sygmaBridge,
    portalBridge,
  }
}
