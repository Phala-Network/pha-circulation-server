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

const phalaDocument = `
  {
    circulationById(id: "0") {
      circulation
      crowdloan
      reward
      sygmaBridge
      timestamp
      totalIssuance
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

interface PhalaCirculation extends Circulation {
  crowdloan: string
  reward: string
  sygmaBridge: string
  totalIssuance: string
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

class PhalaGraphQLClient extends GraphQLClient {
  constructor() {
    super('/phala-circulation/graphql')
  }
  requestAll() {
    return this.request<PhalaCirculation>(phalaDocument)
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

const phala = new PhalaGraphQLClient()
const ethereum = new EthereumGraphQLClient()
const base = new BaseGraphQLClient()

const app = new Hono().basePath('/api').use('*', cors())

const calculateTotalCirculation = (
  phalaData: Circulation,
  ethereumData: Circulation,
  baseData: Circulation,
) =>
  new Decimal(phalaData.circulation)
    .plus(ethereumData.circulation)
    .plus(baseData.circulation)
    .toDP(12, Decimal.ROUND_DOWN)
    .toString()

app.get('*', async (c, next) => {
  c.res.headers.set('Cache-Control', 'public, max-age=60')
  await next()
})

app.get('/circulation', async (c) => {
  const phalaData = await phala.requestCirculation()
  const ethereumData = await ethereum.requestCirculation()
  const baseData = await base.requestCirculation()
  return c.text(calculateTotalCirculation(phalaData, ethereumData, baseData))
})

app.get('/all', async (c) => {
  const khalaData = {
    circulation: '0',
    crowdloan: '0',
    reward: '0',
    sygmaBridge: '0',
    timestamp: new Date().toISOString(),
    totalIssuance: '0',
  }

  const phalaData = await phala.requestAll()
  const ethereumData = await ethereum.requestAll()
  const baseData = await base.requestAll()
  return c.json({
    phala: phalaData,
    khala: khalaData,
    ethereum: ethereumData,
    base: baseData,
    totalCirculation: calculateTotalCirculation(
      phalaData,
      ethereumData,
      baseData,
    ),
  })
})

export default handle(app)
