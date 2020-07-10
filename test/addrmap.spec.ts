import { expect } from 'chai'
import { AddressMap, DefaultEntryKey, WildcardEntryKey } from '../src/addrmap'

describe('[addrmap.ts] AddressMap', () => {
  let map: AddressMap<number>
  beforeEach(() => {
    map = new AddressMap()
  })
  describe('put', () => {
    it('assigns first level default', () => {
      map.put([], 2)
      expect(map.table).to.be.deep.equal({ [DefaultEntryKey]: 2 })
    })
    it('assigns nested level defaults', () => {
      map.put(['net', 'kb1rd', 'test'], 5)
      expect(map.table).to.be.deep.equal({
        net: {
          kb1rd: {
            test: {
              [DefaultEntryKey]: 5
            }
          }
        }
      })
    })
    it('ignores existing nested level', () => {
      map.put(['net', 'kb1rd', 'test'], 5)
      map.put(['net', 'example', 'test'], 4)
      expect(map.table).to.be.deep.equal({
        net: {
          kb1rd: {
            test: {
              [DefaultEntryKey]: 5
            }
          },
          example: {
            test: {
              [DefaultEntryKey]: 5
            }
          }
        }
      })
    })
    it('deletes existing key if undefined', () => {
      map.put(['net', 'kb1rd', 'test'], 5)
      map.put(['net', 'kb1rd', 'test'], undefined)
      expect(map.table).to.be.deep.equal({
        net: {
          kb1rd: {
            test: {
              [DefaultEntryKey]: undefined
            }
          }
        }
      })
    })
    it('uses WildcardEntryKey in place of `undefined`', () => {
      map.put(['net', 'kb1rd', undefined], 5)
      expect(map.table).to.be.deep.equal({
        net: {
          kb1rd: {
            [WildcardEntryKey]: {
              [DefaultEntryKey]: 5
            }
          }
        }
      })
    })
  })
  describe('get', () => {
    it('defaults to first level default', () => {
      map.put([], 2)
      expect(map.get(['does', 'not', 'exist'])).to.be.equal(2)
    })
    it('gets default when requested', () => {
      map.put([], 2)
      map.put(['not', 'right'], 3)
      expect(map.get([])).to.be.equal(2)
    })
    it('gets deeper levels when requested', () => {
      map.put(['not', 'not', 'right'], 2)
      map.put(['not', 'right'], 3)
      expect(map.get(['not', 'not', 'right'])).to.be.equal(2)
    })
    it('pushes wildcards to `wc_values`', () => {
      const addr = ['deeply', 'nested', 'maybe undefined', 'wildcard']
      map.put(['deeply', 'nested', undefined, 'wildcard'], 3)
      const wc_values: string[] = []
      expect(map.get(addr, wc_values)).to.be.equal(3)
      expect(wc_values).to.be.deep.equal(['maybe undefined'])
    })
    it('does not follow wildcard if more specific option', () => {
      const addr = ['deeply', 'nested', 'defined', 'wildcard']
      map.put(['deeply', 'nested', undefined, 'wildcard'], 3)
      map.put(['deeply', 'nested', 'defined', 'wildcard'], 2)
      const wc_values: string[] = []
      expect(map.get(addr, wc_values)).to.be.equal(2)
      expect(wc_values).to.be.deep.equal([])
    })
    it('does not mutate address', () => {
      const addr = ['deeply', 'nested', 'maybe undefined', 'wildcard']
      map.put(['deeply', 'nested', undefined, 'wildcard'], 3)
      map.get(addr)
      expect(addr).to.be.deep.equal(
        ['deeply', 'nested', 'maybe undefined', 'wildcard']
      )
    })
  })
  describe('toString', () => {
    it('works', () => {
      map.put([], 2)
      map.put([undefined], 6)
      map.put(['a', undefined, undefined, 'd'], 5)
      map.put(['a', undefined, 'c'], 4)
      map.put(['a', 'b', 'c'], 3)
      map.table.a.b[DefaultEntryKey] = undefined
      expect(map.toString()).to.be.equal(`AddrMap [
  : 2
  *: 6
  [a].*.*.[d]: 5
  [a].*.[c]: 4
  [a].[b].[c]: 3
]`)
    })
  })
})