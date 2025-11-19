import Decimal from 'decimal.js'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {handle} from 'hono/vercel'

Decimal.set({toExpNeg: -9e15, toExpPos: 9e15, precision: 50})

export const config = {
  runtime: 'edge',
}

const baseUrl = 'https://subsquid.phala.network'

const circulationDocument = `
  {
    circulationById(id: "0") {
      circulation
    }
  }
`

const ethereumDocument = `
  {
    circulationById(id: "0") {
      circulation
      phalaChainBridge
      khalaChainBridge
      reward
      sygmaBridge
      portalBridge
      timestamp
      totalSupply
      vaultReward
    }
  }
`

const baseDocument = `
  {
    circulationById(id: "0") {
      circulation
      totalSupply
      timestamp
    }
  }
`

interface Circulation {
  circulation: string
  timestamp: string
}

interface EthereumCirculation extends Circulation {
  phalaChainBridge: string
  khalaChainBridge: string
  reward: string
  sygmaBridge: string
  totalSupply: string
  vaultReward: string
}

interface BaseCirculation extends Circulation {
  totalSupply: string
}

interface Res<T> {
  data: {
    circulationById: T
  }
}

abstract class GraphQLClient {
  constructor(readonly url: string) {
    this.url = new URL(url, baseUrl).toString()
  }
  request<T>(document: string) {
    return fetch(this.url, {
      method: 'POST',
      body: JSON.stringify({query: document}),
      headers: {'Content-Type': 'application/json'},
    })
      .then((res) => res.json() as Promise<Res<T>>)
      .then((res) => res.data.circulationById)
  }
  requestCirculation() {
    return this.request<Circulation>(circulationDocument)
  }
}

class EthereumGraphQLClient extends GraphQLClient {
  constructor() {
    super('/ethereum-pha-circulation/graphql')
  }
  requestAll() {
    return this.request<EthereumCirculation>(ethereumDocument)
  }
}

class BaseGraphQLClient extends GraphQLClient {
  constructor() {
    super('/base-pha-circulation/graphql')
  }
  requestAll() {
    return this.request<BaseCirculation>(baseDocument)
  }
}

const ethereum = new EthereumGraphQLClient()
const base = new BaseGraphQLClient()

const app = new Hono().basePath('/api').use('*', cors())

const calculateTotalCirculation = (
  ethereumData: Circulation,
  baseData: Circulation,
) =>
  new Decimal(ethereumData.circulation)
    .plus(baseData.circulation)
    .toDP(12, Decimal.ROUND_DOWN)
    .toString()

const getAllData = async () => {
  const khalaData = {
    circulation: '0',
    crowdloan: '0',
    reward: '0',
    sygmaBridge: '0',
    timestamp: new Date().toISOString(),
    totalIssuance: '0',
  }

  const phalaData = {
    circulation: '0',
    crowdloan: '0',
    reward: '0',
    sygmaBridge: '0',
    timestamp: new Date().toISOString(),
    totalIssuance: '0',
  }

  const phalaCirculation = '145357088.293045867646'
  const phalaReward = '191763908.252539075609'

  const ethereumData = await ethereum.requestAll()
  const baseData = await base.requestAll()

  ethereumData.circulation = new Decimal(ethereumData.circulation)
    .plus(phalaCirculation)
    .toString()
  ethereumData.reward = new Decimal(ethereumData.reward)
    .plus(phalaReward)
    .toString()

  return {
    phala: phalaData,
    khala: khalaData,
    ethereum: ethereumData,
    base: baseData,
    totalCirculation: calculateTotalCirculation(ethereumData, baseData),
  }
}

app.get('*', async (c, next) => {
  c.res.headers.set(
    'Cache-Control',
    'public, max-age=60, stale-while-revalidate=60',
  )
  await next()
})

app.get('/circulation', async (c) => {
  const data = await getAllData()
  return c.text(data.totalCirculation)
})

app.get('/all', async (c) => {
  const data = await getAllData()
  return c.json(data)
})

export default handle(app)
