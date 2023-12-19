import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {handle} from 'hono/vercel'
import {kv} from '@vercel/kv'

export const config = {
  runtime: 'edge',
}

const app = new Hono().basePath('/api').use('*', cors())

app.get('/circulation', async (c) => {
  const value = await kv.get('totalCirculation')
  if (typeof value === 'string') {
    return c.text(value)
  } else {
    throw new Error('Not found')
  }
})

app.get('/all', async (c) => {
  const [
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
  ] = await kv.mget([
    'ethereumTotalSupply',
    'ethereumMiningRewards',
    'ethereumPhalaChainbridge',
    'ethereumKhalaChainbridge',
    'ethereumSygmaBridge',
    'ethereumCirculation',

    'phalaTotalIssuance',
    'phalaMiningRewards',
    'phalaCrowdloan',
    'phalaChainbridge',
    'phalaSygmaBridge',
    'phalaCirculation',

    'khalaTotalIssuance',
    'khalaMiningRewards',
    'khalaCrowdloan',
    'khalaChainbridge',
    'khalaSygmaBridge',
    'khalaCirculation',

    'totalCirculation',

    'lastUpdate',
  ])

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

  for (let k in json) {
    if (k === 'lastUpdate') continue
    const key = k as keyof typeof json
    if (typeof json[key] === 'number') {
      json[key] = String(json[key])
    }
  }

  return c.json(json)
})

export default handle(app)
