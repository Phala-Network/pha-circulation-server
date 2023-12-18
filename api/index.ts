import {Hono} from 'hono'
import {handle} from 'hono/vercel'
import {kv} from '@vercel/kv'

export const config = {
  runtime: 'edge',
}

const app = new Hono().basePath('/api')

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

  return c.json({
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
  })
})

export default handle(app)
