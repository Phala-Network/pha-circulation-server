import {expect, test} from 'bun:test'
import {cached} from './cache.js'

test('shares one computation between concurrent and later calls', async () => {
  let calls = 0
  const compute = async () => {
    calls++
    await Bun.sleep(10)
    return {value: calls}
  }
  const results = await Promise.all([
    cached('shared', 60, compute),
    cached('shared', 60, compute),
  ])
  expect(results).toEqual([{value: 1}, {value: 1}])
  expect(await cached('shared', 60, compute)).toEqual({value: 1})
  expect(calls).toBe(1)
})

test('does not cache failures', async () => {
  let calls = 0
  const compute = async () => {
    calls++
    if (calls === 1) throw new Error('upstream down')
    return 'ok'
  }
  await expect(cached('failing', 60, compute)).rejects.toThrow('upstream down')
  expect(await cached('failing', 60, compute)).toBe('ok')
})
