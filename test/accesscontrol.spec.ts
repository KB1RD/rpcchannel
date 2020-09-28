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
  FunctionLookupAccessController,
  RpcChannel,
  AutoFunctionAccessController,
  RequiresPermissions,
  CanCallFunction,
  OptAccessPolicy
} from '../src/index'

const default_opts = {
  args: [{}, Symbol(), 'hi'],
  channel: new RpcChannel(() => undefined),
  func: () => undefined
}

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
    expect(new FunctionAccessController(
      (a: MultistringAddress, opts) => {
        expect(a).to.be.equal(addr)
        expect(opts).to.be.equal(default_opts)
        return true
      }
    ).can(addr, default_opts)).to.be.true
  })
})
describe('[accesscontrol.ts] ChainedAccessController', () => {
  it('default works', () => {
    expect(
      new ChainedAccessController(AccessPolicy.ALLOW).can([], default_opts)
    ).to.be.equal(AccessPolicy.ALLOW)
  })
  it('calls in order with same data, stopping when value provided', () => {
    const addr = ['net', 'kb1rd', 'test']
    const data = [{}, Symbol(), 'hi']
    const ac = new ChainedAccessController(AccessPolicy.ALLOW)
    const calls: number[] = []
    ac.access_chain.push(new FunctionAccessController((a, o) => {
      expect(a).to.be.equal(addr)
      expect(o).to.be.equal(default_opts)
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
    expect(ac.can(addr, default_opts)).to.be.equal(AccessPolicy.DENY)
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
  it('returns `OptAccessPolicy.NONE` if function undefined', () => {
    const ac = new FunctionLookupAccessController()
    ac.map.put(['net', 'kb1rd', undefined], () => AccessPolicy.ALLOW)
    
    expect(ac.can(['com', 'kb1rd', 'test'], default_opts))
      .to.be.equal(OptAccessPolicy.NONE)
  })
  it('lookup works', () => {
    const addr = ['net', 'kb1rd', 'test']
    const data = [{}, Symbol(), 'hi']
    const ac = new FunctionLookupAccessController()
    ac.map.put(['net', 'kb1rd', undefined], (a, o) => {
      expect(a).to.be.equal(addr)
      expect(o).to.be.equal(default_opts)
      return AccessPolicy.ALLOW
    })
    
    expect(ac.can(addr, default_opts)).to.be.equal(AccessPolicy.ALLOW)
  })
})
describe('[accesscontrol.ts] AutoFunctionAccessController', () => {
  it('defaults to none', () => {
    const ac = new AutoFunctionAccessController()

    expect(ac.can(['com', 'kb1rd', 'test'], default_opts))
      .to.be.equal(OptAccessPolicy.NONE)
  })
  it('denies if missing even one permission before calling func', () => {
    const ac = new AutoFunctionAccessController()
    ac.perms.add('net.kb1rd.teststuff')

    const opts = Object.assign(
      {},
      default_opts,
      {
        func: Object.assign(
          () => undefined,
          {
            [RequiresPermissions]: [
              'net.kb1rd.teststuff',
              'net.kb1rd.security'
            ],
            [CanCallFunction]: () => {
              throw new TypeError('This should never happen')
            }
          }
        )
      }
    )
    expect(ac.can(['com', 'kb1rd', 'test'], opts))
      .to.be.equal(AccessPolicy.DENY)
  })
  it('requesting perms in function has same effect', () => {
    const ac = new AutoFunctionAccessController()
    ac.perms.add('net.kb1rd.teststuff')

    const opts = Object.assign(
      {},
      default_opts,
      {
        func: Object.assign(
          () => undefined,
          {
            [CanCallFunction]: (
              to: MultistringAddress,
              { require }: { require: (s: string) => void }
            ) => {
              require('net.kb1rd.teststuff')
              require('net.kb1rd.security')
            }
          }
        )
      }
    )
    expect(ac.can(['com', 'kb1rd', 'test'], opts))
      .to.be.equal(AccessPolicy.DENY)
  })
  it('returns function value', () => {
    const ac = new AutoFunctionAccessController()
    ac.perms.add('net.kb1rd.teststuff')

    const opts = Object.assign(
      {},
      default_opts,
      {
        func: Object.assign(
          () => undefined,
          { [CanCallFunction]: () => AccessPolicy.ALLOW }
        )
      }
    )
    expect(ac.can(['com', 'kb1rd', 'test'], opts))
      .to.be.equal(AccessPolicy.ALLOW)
  })
  it('defaults to `OptAccessPolicy.NONE` when function returns', () => {
    const ac = new AutoFunctionAccessController()
    ac.perms.add('net.kb1rd.teststuff')

    const opts = Object.assign(
      {},
      default_opts,
      {
        func: Object.assign(
          () => undefined,
          { [CanCallFunction]: () => undefined }
        )
      }
    )
    expect(ac.can(['com', 'kb1rd', 'test'], opts))
      .to.be.equal(OptAccessPolicy.NONE)
  })
})