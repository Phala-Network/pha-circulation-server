import Decimal from 'decimal.js'
import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {handle} from 'hono/vercel'

Decimal.set({toExpNeg: -9e15, toExpPos: 9e15, precision: 50})

export const config = {
  runtime: 'edge',
}

const base = 'https://subsquid.phala.network'

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
      timestamp
      totalSupply
    }
  }
`

interface Circulation {
  circulation: string
}

interface PhalaCirculation {
  circulation: string
  crowdloan: string
  reward: string
  sygmaBridge: string
  timestamp: string
  totalIssuance: string
}

interface EthereumCirculation {
  circulation: string
  phalaChainBridge: string
  khalaChainBridge: string
  reward: string
  sygmaBridge: string
  timestamp: string
  totalSupply: string
}

interface Res<T> {
  data: {
    circulationById: T
  }
}

abstract class GraphQLClient {
  constructor(readonly url: string) {
    this.url = new URL(url, base).toString()
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
  constructor(readonly chain: 'phala' | 'khala') {
    super(`/${chain}-circulation/graphql`)
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

const phala = new PhalaGraphQLClient('phala')
const khala = new PhalaGraphQLClient('khala')
const ethereum = new EthereumGraphQLClient()

const app = new Hono().basePath('/api').use('*', cors())

const calculateTotalCirculation = (
  phalaData: Circulation,
  khalaData: Circulation,
  ethereumData: Circulation,
) =>
  new Decimal(phalaData.circulation)
    .plus(khalaData.circulation)
    .plus(ethereumData.circulation)
    .toDP(12, Decimal.ROUND_DOWN)
    .toString()

app.get('*', async (c, next) => {
  c.res.headers.set('Cache-Control', 'public, max-age=60')
  await next()
})

app.get('/circulation', async (c) => {
  const phalaData = await phala.requestCirculation()
  const khalaData = await khala.requestCirculation()
  const ethereumData = await ethereum.requestCirculation()
  return c.text(calculateTotalCirculation(phalaData, khalaData, ethereumData))
})

app.get('/all', async (c) => {
  const phalaData = await phala.requestAll()
  const khalaData = await khala.requestAll()
  const ethereumData = await ethereum.requestAll()
  return c.json({
    phala: phalaData,
    khala: khalaData,
    ethereum: ethereumData,
    totalCirculation: calculateTotalCirculation(
      phalaData,
      khalaData,
      ethereumData,
    ),
  })
})

export default handle(app)
