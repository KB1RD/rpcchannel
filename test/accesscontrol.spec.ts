import { expect } from 'chai'
import {
  AllowAccessController,
  DenyAccessController,
  FunctionAccessController,
  MultistringAddress,
  SerializableData,
  AccessPolicy,
  ChainedAccessController,
  LegacyAccessController,
  FunctionLookupAccessController
} from '../src/index'

describe('[accesscontrol.ts] AllowAccessController', () => {
  it('always returns true', () => {
    expect(new AllowAccessController().can()).to.be.true
  })
})
describe('[accesscontrol.ts] DenyAccessController', () => {
  it('always returns false', () => {
    expect(new DenyAccessController().can()).to.be.false
  })
})
describe('[accesscontrol.ts] DenyAccessController', () => {
  it('always calls function', () => {
    const addr = ['net', 'kb1rd', 'test']
    const data = [{}, Symbol(), 'hi']
    expect(new FunctionAccessController(
      (a: MultistringAddress, d: SerializableData[]) => {
        expect(a).to.be.equal(addr)
        expect(d).to.be.equal(data)
        return true
      }
    ).can(addr, data)).to.be.true
  })
})
describe('[accesscontrol.ts] ChainedAccessController', () => {
  it('default works', () => {
    expect(
      new ChainedAccessController(AccessPolicy.ALLOW).can([], [])
    ).to.be.equal(AccessPolicy.ALLOW)
  })
  it('calls in order with same data, stopping when value provided', () => {
    const addr = ['net', 'kb1rd', 'test']
    const data = [{}, Symbol(), 'hi']
    const ac = new ChainedAccessController(AccessPolicy.ALLOW)
    const calls: number[] = []
    ac.access_chain.push(new FunctionAccessController((a, d) => {
      expect(a).to.be.equal(addr)
      expect(d).to.be.equal(data)
      calls.push(1)
      return undefined
    }))
    ac.access_chain.push(new FunctionAccessController(() => {
      calls.push(2)
      return AccessPolicy.DENY
    }))
    ac.access_chain.push(new FunctionAccessController(() => {
      calls.push(3)
      return undefined
    }))
    expect(ac.can(addr, data)).to.be.equal(AccessPolicy.DENY)
    expect(calls).to.be.deep.equal([1, 2])
  })
})
describe('[accesscontrol.ts] LegacyAccessController', () => {
  it('matches (assumes AddressMap works)', () => {
    const ac = new LegacyAccessController()
    ac.map.put(['net', 'kb1rd', undefined], AccessPolicy.ALLOW)
    
    expect(ac.can(['net', 'kb1rd', 'test'])).to.be.equal(AccessPolicy.ALLOW)
  })
})
describe('[accesscontrol.ts] FunctionLookupAccessController', () => {
  it('returns undefined if function undefined', () => {
    const ac = new FunctionLookupAccessController()
    ac.map.put(['net', 'kb1rd', undefined], () => AccessPolicy.ALLOW)
    
    expect(ac.can(['com', 'kb1rd', 'test'], [])).to.be.undefined
  })
  it('lookup works', () => {
    const addr = ['net', 'kb1rd', 'test']
    const data = [{}, Symbol(), 'hi']
    const ac = new FunctionLookupAccessController()
    ac.map.put(['net', 'kb1rd', undefined], (a, d) => {
      expect(a).to.be.equal(addr)
      expect(d).to.be.equal(data)
      return AccessPolicy.ALLOW
    })
    
    expect(ac.can(addr, data)).to.be.equal(AccessPolicy.ALLOW)
  })
})