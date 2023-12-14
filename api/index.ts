import {Hono} from 'hono'
import {handle} from 'hono/vercel'
import {ApiPromise, HttpProvider} from '@polkadot/api'
import {createPublicClient, getContract, http} from 'viem'
import {mainnet} from 'viem/chains'
import {kv} from '@vercel/kv'
import Decimal from 'decimal.js'

const minABI = [
  {
    constant: true,
    inputs: [{name: '_owner', type: 'address'}],
    name: 'balanceOf',
    outputs: [{name: 'balance', type: 'uint256'}],
    type: 'function',
  },
]

export const config = {
  runtime: 'edge',
}

const app = new Hono().basePath('/api')

app.get('/circulation', async (c) => {
  const value = await kv.get('circulation')
  if (typeof value === 'string') {
    return c.text(value)
  } else {
    throw new Error('Not found')
  }
})

app.get('/all', async (c) => {
  const ethMiningRewards = await kv.get('ethMiningRewards')
  const khalaMiningRewards = await kv.get('khalaMiningRewards')
  const phalaMiningRewards = await kv.get('phalaMiningRewards')
  const phalaCrowdloan = await kv.get('phalaCrowdloan')
  const circulation = await kv.get('circulation')
  const lastUpdate = await kv.get('lastUpdate')

  return c.json({
    ethMiningRewards,
    khalaMiningRewards,
    phalaMiningRewards,
    phalaCrowdloan,
    circulation,
    lastUpdate,
  })
})

app.get('/update', async (c) => {
  Decimal.set({toExpNeg: -100, toExpPos: 100, precision: 18})
  const createApi = async (endpoint: string) =>
    ApiPromise.create({
      provider: new HttpProvider(endpoint),
      noInitWarn: true,
    })
  const [phalaApi, khalaApi] = await Promise.all([
    createApi('https://priv-api.phala.network/phala/ws'),
    createApi('https://priv-api.phala.network/khala/ws'),
  ])
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(),
  })

  const getEthPhaBalance = async (address: `0x${string}`) => {
    const res = (await publicClient.readContract({
      address: '0x6c5bA91642F10282b576d91922Ae6448C9d52f4E',
      abi: minABI,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint

    return new Decimal(res.toString()).div(1e18).toString()
  }

  const getSubstrateBalance = async (api: ApiPromise, address: string) => {
    const res = await api.query.system.account(address)
    return new Decimal((res.toJSON() as any).data.free).div(1e12).toString()
  }

  const [
    ethMiningRewards,
    khalaMiningRewards,
    phalaMiningRewards,
    phalaCrowdloan,
  ] = await Promise.all([
    getEthPhaBalance('0x4731bc41b3cca4c2883b8ebb68cb546d5b3b4dd6'),
    getSubstrateBalance(
      khalaApi,
      '5EYCAe5iixJKLJE7D1zaaRxUiy2bL4KUKqZBSckPw3iWSyvk'
    ),
    getSubstrateBalance(
      phalaApi,
      '5EYCAe5iixJKLJE7D1zaaRxUiy2bL4KUKqZBSckPw3iWSyvk'
    ),
    getSubstrateBalance(
      phalaApi,
      '42fy3tTMPbgxbRqkQCyvLoSoPHwUPM3Dy5iqHYhF9RvD5XAP'
    ),
  ])

  const lastUpdate = Date.now()

  await kv.set('ethMiningRewards', ethMiningRewards)
  await kv.set('khalaMiningRewards', khalaMiningRewards)
  await kv.set('phalaMiningRewards', phalaMiningRewards)
  await kv.set('phalaCrowdloan', phalaCrowdloan)
  await kv.set('lastUpdate', lastUpdate)

  const circulation = new Decimal(1e9)
    .minus(ethMiningRewards)
    .minus(khalaMiningRewards)
    .minus(phalaMiningRewards)
    .minus(phalaCrowdloan)
    .toString()

  await kv.set('circulation', circulation)

  return c.json({
    ethMiningRewards: ethMiningRewards.toString(),
    khalaMiningRewards: khalaMiningRewards.toString(),
    phalaMiningRewards: phalaMiningRewards.toString(),
    phalaCrowdloan: phalaCrowdloan.toString(),
    circulation,
    lastUpdate,
  })
})

export default handle(app)
