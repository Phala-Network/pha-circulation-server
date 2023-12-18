import Decimal from 'decimal.js'
import {createPublicClient, http} from 'viem'
import {mainnet} from 'viem/chains'
import {kv} from '@vercel/kv'
import {CronJob} from 'cron'
import {ApiPromise, HttpProvider} from '@polkadot/api'

Decimal.set({toExpNeg: -100, toExpPos: 100, precision: 18})

const ETHEREUM_REWARD_ADDRESS = '0x4731bc41b3cca4c2883b8ebb68cb546d5b3b4dd6'
const ETHEREUM_PHALA_CHAINBRIDGE_ADDRESS =
  '0xcd38b15a419491c7c1238b0659f65c755792e257'
const ETHEREUM_KHALA_CHAINBRIDGE_ADDRESS =
  '0xeec0fb4913119567cdfc0c5fc2bf8f9f9b226c2d'
const ETHEREUM_SYGMA_BRIDGE_ADDRESS =
  '0xC832588193cd5ED2185daDA4A531e0B26eC5B830'
const PHALA_CROWDLOAN_ADDRESS =
  '42fy3tTMPbgxbRqkQCyvLoSoPHwUPM3Dy5iqHYhF9RvD5XAP'
const PHALA_REWARD_ADDRESS = '5EYCAe5iixJKLJE7D1zaaRxUiy2bL4KUKqZBSckPw3iWSyvk'
const PHALA_CHAINBRIDGE_ADDRESS =
  '436H4jat7TobTbNX4RCH5p7qgErHbGTo1MyZhLVaSX4FkKyz'
const PHALA_SYGMA_BRIDGE_ADDRESS =
  '436H4jatj6ntHTVm3wh9zs1Mqa8p1ykfcdkNH7txmjmohTu3'

const ethereumTotalSupply = (1e9).toString()

const endpoint = {
  khala: 'https://khala-rpc.dwellir.com',
  phala: 'https://phala-rpc.dwellir.com',
} as const

const createApi = async (chain: keyof typeof endpoint): Promise<ApiPromise> =>
  await ApiPromise.create({
    provider: new HttpProvider(endpoint[chain]),
    noInitWarn: true,
  })

const [phalaApi, khalaApi] = await Promise.all([
  createApi('phala'),
  createApi('khala'),
])

const minABI = [
  {
    constant: true,
    inputs: [{name: '_owner', type: 'address'}],
    name: 'balanceOf',
    outputs: [{name: 'balance', type: 'uint256'}],
    type: 'function',
  },
]

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
})

const getEthereumPHABalance = async (
  address: `0x${string}`
): Promise<string> => {
  const res = (await publicClient.readContract({
    address: '0x6c5bA91642F10282b576d91922Ae6448C9d52f4E',
    abi: minABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint

  return new Decimal(res.toString()).div(1e18).toString()
}

const getSubstrateBalance = async (
  api: ApiPromise,
  address: string
): Promise<string> => {
  const res = await api.query.system.account(address)
  return new Decimal((res.toJSON() as any).data.free).div(1e12).toString()
}

const getSubstrateTotalIssuance = async (api: ApiPromise): Promise<string> => {
  const res = await api.query.balances.totalIssuance()
  return new Decimal(res.toString()).div(1e12).toString()
}

const update = async (): Promise<void> => {
  const [
    ethereumMiningRewards,
    ethereumPhalaChainbridge,
    ethereumKhalaChainbridge,
    ethereumSygmaBridge,

    phalaTotalIssuance,
    phalaMiningRewards,
    phalaCrowdloan,
    phalaChainbridge,
    phalaSygmaBridge,

    khalaTotalIssuance,
    khalaMiningRewards,
    khalaCrowdloan,
    khalaChainbridge,
    khalaSygmaBridge,
  ] = await Promise.all([
    getEthereumPHABalance(ETHEREUM_REWARD_ADDRESS),
    getEthereumPHABalance(ETHEREUM_PHALA_CHAINBRIDGE_ADDRESS),
    getEthereumPHABalance(ETHEREUM_KHALA_CHAINBRIDGE_ADDRESS),
    getEthereumPHABalance(ETHEREUM_SYGMA_BRIDGE_ADDRESS),

    getSubstrateTotalIssuance(phalaApi),
    getSubstrateBalance(phalaApi, PHALA_REWARD_ADDRESS),
    getSubstrateBalance(phalaApi, PHALA_CROWDLOAN_ADDRESS),
    getSubstrateBalance(phalaApi, PHALA_CHAINBRIDGE_ADDRESS),
    getSubstrateBalance(phalaApi, PHALA_SYGMA_BRIDGE_ADDRESS),

    getSubstrateTotalIssuance(khalaApi),
    getSubstrateBalance(khalaApi, PHALA_REWARD_ADDRESS),
    getSubstrateBalance(khalaApi, PHALA_CROWDLOAN_ADDRESS),
    getSubstrateBalance(khalaApi, PHALA_CHAINBRIDGE_ADDRESS),
    getSubstrateBalance(khalaApi, PHALA_SYGMA_BRIDGE_ADDRESS),
  ])

  const lastUpdate = Date.now()

  const ethereumCirculation = new Decimal(ethereumTotalSupply)
    .minus(ethereumPhalaChainbridge)
    .minus(ethereumKhalaChainbridge)
    .minus(ethereumSygmaBridge)
    .toString()

  const phalaCirculation = new Decimal(phalaTotalIssuance)
    .minus(phalaMiningRewards)
    .minus(phalaCrowdloan)
    .minus(phalaChainbridge)
    .minus(phalaSygmaBridge)
    .toString()

  const khalaCirculation = new Decimal(khalaTotalIssuance)
    .minus(khalaMiningRewards)
    .minus(khalaCrowdloan)
    .minus(khalaChainbridge)
    .minus(khalaSygmaBridge)
    .toString()

  const totalCirculation = new Decimal(ethereumCirculation)
    .plus(phalaCirculation)
    .plus(khalaCirculation)
    .toString()

  const json = {
    ethereumTotalSupply,
    ethereumMiningRewards,
    ethereumPhalaChainbridge,
    ethereumKhalaChainbridge,
    ethereumSygmaBridge,
    ethereumCirculation,

    phalaTotalIssuance,
    phalaMiningRewards,
    phalaCrowdloan,
    phalaChainbridge,
    phalaSygmaBridge,
    phalaCirculation,

    khalaTotalIssuance,
    khalaMiningRewards,
    khalaCrowdloan,
    khalaChainbridge,
    khalaSygmaBridge,
    khalaCirculation,

    totalCirculation,

    lastUpdate,
  }

  await kv.mset(json)

  console.log(json)
}

await update()

const job = new CronJob('*/10 * * * *', update, null, null, 'utc')

job.start()
