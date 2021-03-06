import { expect } from 'chai'
import {
  toRpcSerialized,
  InvalidChannelError,
  ForwardedError,
  RpcChannel,
  RpcMessage,
  RpcRemappedFunction,
  RpcAddress,
  RemapArguments,
  RpcFunctionAddress,
  RpcFunction,
  RpcHandlerRegistry,
  MultistringAddress,
  FunctionAccessController,
  RpcState
} from '../src/index'

/**
 * This library was designed for full async, so sometimes, it is impossible to
 * `await` a specific promise completion to see if a generator has created the
 * correct messages, for example. The easiest solution was to literally just
 * wait a while to ensure that the `expect`ing code runs at the bottom of the
 * async queue.
 */
const static_await_delay = 1

describe('[registry.ts] RpcAddress', () => {
  it('sets RpcFunctionAddress on member function', () => {
    class Test {
      @RpcAddress(['net', 'kb1rd', undefined])
      member(): number {
        return 1
      }
    }
    expect((new Test().member as any)[RpcFunctionAddress]).to.be.deep.equal(
      ['net', 'kb1rd', undefined]
    )
  })
  it('throws error when applied to non-function', () => {
    expect(() => {
      const myobj = {}
      RpcAddress([])(
        myobj,
        'test',
        {
          configurable: true,
          enumerable: false,
          value: 'hi',
          writable: true,
          get(): string {
            return 'hi'
          },
          set(v: any): void {
            throw new Error('Should not happen')
          }
        }
      )
    }).to.throw('Cannot mark non-function as RPC function')
  })
})

describe('[registry.ts] RpcHandlerRegistry', () => {
  it('nextSeqAddr allocates sequential return addresses', () => {
    const hr = new RpcHandlerRegistry()
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id0'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id1'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id2'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id3'])
  })
})

describe('[registry.ts] RpcChannel', () => {
  // Register already tested via AddressMap. I know, UNIT testing, but I'm lazy
  let c: RpcChannel
  let sent_msgs: [RpcMessage, Transferable[]][]
  beforeEach(() => {
    sent_msgs = []
    c = new RpcChannel((msg, xfer) => sent_msgs.push([msg, xfer]))
  })
  afterEach(() => {
    c.close()
  })
  describe('_stateChange', () => {
    it('emits event', () => {
      let events: [RpcState, RpcState][] = []
      c.on('statechange', (c, o) => events.push([c, o]))

      c._stateChange(RpcState.ACTIVE)
      expect(events).to.be.deep.equal([[RpcState.ACTIVE, RpcState.INACTIVE]])
      events.length = 0
      c._stateChange(RpcState.CLOSED)
      expect(events).to.be.deep.equal([[RpcState.CLOSED, RpcState.ACTIVE]])
    })
    it('emits active event', () => {
      let events: undefined[] = []
      c.on('active', () => events.push(undefined))

      c._stateChange(RpcState.ACTIVE)
      expect(events.length).to.be.deep.equal(1)
      c._stateChange(RpcState.CLOSED)
      expect(events.length).to.be.deep.equal(1)
    })
    it('emits closed event', () => {
      let events: undefined[] = []
      c.on('close', () => events.push(undefined))

      c._stateChange(RpcState.CLOSED)
      expect(events.length).to.be.deep.equal(1)
      c._stateChange(RpcState.ACTIVE)
      expect(events.length).to.be.deep.equal(1)
    })
  })
  describe('start/stop', () => {
    it('starts `INACTIVE`', () => {
      expect(c.state).to.be.equal(RpcState.INACTIVE)
    })
    it('`start` transitions to `ACTIVE`', async () => {
      expect(c.state).to.be.equal(RpcState.INACTIVE)
      await c.start()
      expect(c.state).to.be.equal(RpcState.ACTIVE)
    })
    it('waits for message if `await_first_msg` is set', async () => {
      expect(c.state).to.be.equal(RpcState.INACTIVE)
      c.setAwaitFirstMsg(true)
      let done = false
      c.start().then(() => (done = true))
      expect(done).to.be.false
      await new Promise((r) => setTimeout(r, 20))
      expect(done).to.be.false
      expect(c.state).to.be.equal(RpcState.INACTIVE)
      c.receive({ to: ['_', 'keepalive'], args: [] })
      await new Promise((r) => setTimeout(r, 1))
      expect(done).to.be.true
      expect(c.state).to.be.equal(RpcState.ACTIVE)
    })
    it('starts timeout', async () => {
      c.setTimeout(5000)
      expect(c.active_timeout).to.be.undefined
      await c.start()
      expect(c.active_timeout).to.not.be.undefined
    })
    it('starts timeout only after awaiting msg', async () => {
      c.setTimeout(5000)
      c.setAwaitFirstMsg(true)
      expect(c.active_timeout).to.be.undefined
      const promise = c.start()
      await new Promise((r) => setTimeout(r, 1))
      expect(c.active_timeout).to.be.undefined
      c.receive({ to: ['_', 'keepalive'], args: [] })
      await promise
      expect(c.active_timeout).to.not.be.undefined
    })
    it('stays closed if closed during await', async () => {
      expect(c.state).to.be.equal(RpcState.INACTIVE)
      c.setAwaitFirstMsg(true)

      // Note the *lack* of await
      let done = false
      c.start().then(() => (done = true))

      await new Promise((r) => setTimeout(r, 5))
      expect(done).to.be.false
      c.close()
      await new Promise((r) => setTimeout(r, 1))
      expect(done).to.be.true
      expect(c.state).to.be.equal(RpcState.CLOSED)

      c.receive({ to: ['_', 'keepalive'], args: [] })
      await new Promise((r) => setTimeout(r, 5))
      expect(c.state).to.be.equal(RpcState.CLOSED)
    })
    it('stays closed if closed before start', async () => {
      expect(c.state).to.be.equal(RpcState.INACTIVE)
      c.close()
      expect(c.state).to.be.equal(RpcState.CLOSED)
      await c.start()
      expect(c.state).to.be.equal(RpcState.CLOSED)
    })
  })
  describe('timeouts', () => {
    it('closes channel after time elapsed', async () => {
      c.setTimeout(20)
      await c.start()
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      await new Promise((r) => setTimeout(r, 1))
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      await new Promise((r) => setTimeout(r, 20))
      expect(c.state).to.be.equal(RpcState.CLOSED)
    })
    it('does not close channel if any event sent', async () => {
      c.setTimeout(20)
      await c.start()
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      await new Promise((r) => setTimeout(r, 10))
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      c.receive({ to: ['sadfsd', 'fsdfsd', 'sdfds'], args: [] })
      await new Promise((r) => setTimeout(r, 11))
      expect(c.state).to.be.equal(RpcState.ACTIVE)
    })
    it('clears old timeout when timeout changed', async () => {
      c.setTimeout(20)
      await c.start()
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      await new Promise((r) => setTimeout(r, 10))
      expect(c.state).to.be.equal(RpcState.ACTIVE)
      c.setTimeout(15)
      await new Promise((r) => setTimeout(r, 10))
      expect(c.state).to.be.equal(RpcState.ACTIVE)
    })
  })
  describe('keepalive', () => {
    it('sends initial keepalive on setup', async () => {
      c.setTimeout(undefined, 10)
      expect(sent_msgs).to.be.deep.equal([[
          {
          to: ['_', 'keepalive'],
          args: [],
          return_type: 'promise',
          return_addr: undefined
        },
        []
      ]])
    })
    it('sends keepalive on interval', async () => {
      c.setTimeout(undefined, 10)
      await c.start()
      sent_msgs.length = 0
      await new Promise((r) => setTimeout(r, 5))
      expect(sent_msgs.length).to.be.equal(0)
      await new Promise((r) => setTimeout(r, 6))
      expect(sent_msgs).to.be.deep.equal([[
          {
          to: ['_', 'keepalive'],
          args: [],
          return_type: 'promise',
          return_addr: undefined
        },
        []
      ]])
    })
  })
  class Test {
    @RpcAddress(['net', 'kb1rd', undefined])
    member(): number {
      return 1
    }
    @RpcAddress(['net', 'kb1rd', 'addnum', undefined])
    addnum(c: RpcChannel, wc: string[], n: number): string {
      return wc[0] + n
    }
    @RpcAddress(['net', 'kb1rd', 'getthis'])
    getthis(): Test {
      return this
    }

    @RemapArguments(['drop'], 'rm')
    remapped_dropfirst(b: string): string {
      return b
    }
    @RemapArguments(['expand', 'expand'], 'rm')
    remapped_expand(a: string, b: string): string {
      return a + b
    }
    @RemapArguments(['expand', 'pass'], 'rm')
    remapped_expand_pass(a: string, b: string): string {
      return a + b
    }
    @RemapArguments(['pass', 'pass'], 'rm')
    remapped_pass(a: string, b: string): string {
      return a + b
    }

    @RpcAddress(['net', 'kb1rd', 'dropfirst'])
    @RemapArguments(['drop'])
    remapped_dropfirst_rpc(b: string): string {
      return b
    }
  }
  describe('RemapArguments', () => {
    // Note: These tests do not call the function with `apply`. Always call
    // with `apply`
    it('drops correctly', () => {
      const test = new Test()
      const res = (
        test.remapped_dropfirst as unknown as { rm: (...args: any[]) => any }
      ).rm('hi', '123')
      expect(res).to.be.equal('123')
    })
    it('expands correctly', () => {
      const test = new Test()
      const res = (
        test.remapped_expand as unknown as { rm: (...args: any[]) => any }
      ).rm(['hi', '123'])
      expect(res).to.be.equal('hi123')
    })
    it('passes correctly', () => {
      const test = new Test()
      const res = (
        test.remapped_pass as unknown as { rm: (...args: any[]) => any }
      ).rm('hi', '123')
      expect(res).to.be.equal('hi123')
    })
    it('expand does not consume next directive', () => {
      const test = new Test()
      const res = (
        test.remapped_expand_pass as unknown as { rm: (...args: any[]) => any }
      ).rm(['hi'], '123')
      expect(res).to.be.equal('hi123')
    })
    it('throws when given non-function', () => {
      expect(() => {
        RemapArguments([])(
          {},
          'test',
          {
            configurable: true,
            enumerable: false,
            value: 'hi',
            writable: true,
            get(): string {
              return 'hi'
            },
            set(v: any): void {
              throw new Error('Should not happen')
            }
          }
        )
      }).to.throw('Cannot remap arguments for non-function')
    })
    it('throws when expanding non-iterable', () => {
      const test = new Test()
      expect(() => {
        ;(test.remapped_expand as unknown as { rm: (...args: any[]) => any })
          .rm(123)
      }).to.throw('Attempted to expand non-iterable')
    })
    it('throws when not enough elements', () => {
      const test = new Test()
      expect(() => {
        ;(test.remapped_expand as unknown as { rm: (...args: any[]) => any })
          .rm([])
      }).to.throw('Expand reached end of array')
    })
  })
  describe('register', () => {
    beforeEach(() => c.start())
    it('basic register', () => {
      const func = () => undefined
      c.register(['net', 'kb1rd', 'test'], func)
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.equal(func)
    })
    it('register from remapped function key', () => {
      interface RemappedFunction {
        (): undefined
        [key: string]: () => undefined
      }
      const func: RemappedFunction = (() => undefined) as RemappedFunction
      const func2 = () => undefined
      func[(RpcRemappedFunction as unknown) as string] = func2

      c.register(['net', 'kb1rd', 'test'], func)
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.equal(func2)
    })
  })
  describe('unregister', () => {
    beforeEach(() => c.start())
    it('unregister by address', () => {
      const func = () => undefined
      c.register(['net', 'kb1rd', 'test'], func)
      c.unregister(['net', 'kb1rd', 'test'])
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.undefined
    })
  })
  describe('registerAll', () => {
    beforeEach(() => c.start())
    it('registers to correct endpoint', () => {
      c.registerAll(new Test() as {})
      expect(
        typeof c.reg.map.get(['net', 'kb1rd', 'literally'])
      ).to.be.equal('function')
      expect(
        typeof c.reg.map.get(['net', 'kb1rd', 'anything'])
      ).to.be.equal('function')
    })
    it('maintains correct value of `this`', () => {
      const test = new Test()
      c.registerAll(test as {})
      expect(
        (c.reg.map.get(['net', 'kb1rd', 'getthis']) as RpcFunction)(c, [])
      ).to.be.equal(test)
    })
    it('register from remapped function key', () => {
      const test = new Test()
      c.registerAll(test as {})
      const a: string[] = []
      expect(
        (c.reg.map.get(['net', 'kb1rd', 'dropfirst']) as RpcFunction)(c, a)
      ).to.be.equal(a)
    })
  })
  describe('unregisterAll', () => {
    beforeEach(() => c.start())
    it('unregisters endpoints', () => {
      c.registerAll(new Test() as {})
      c.unregisterAll(new Test() as {})
      expect(c.reg.map.get(['net', 'kb1rd', 'literally'])).to.be.undefined
      expect(c.reg.map.get(['net', 'kb1rd', 'anything'])).to.be.undefined
    })
  })
  describe('send', () => {
    beforeEach(() => c.start())
    it('defaults to empty args', () => {
      c.send(['net', 'kb1rd', 'hello'])
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: undefined,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('serializes arguments', () => {
      c.send(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: undefined,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('adds `return_addr`', () => {
      c.send(
        ['net', 'kb1rd', 'hello'],
        [],
        ['net', 'kb1rd', 'callreturn']
      )
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: ['net', 'kb1rd', 'callreturn'],
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
  })
  describe('call', () => {
    beforeEach(() => c.start())
    it('defaults to empty args', () => {
      c.call(['net', 'kb1rd', 'hello']).catch(() => undefined)
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('passes args to `send`', () => {
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      ).catch(() => undefined)
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('generates a unique `return_addr`', () => {
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      ).catch(() => undefined)
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      ).catch(() => undefined)
      expect(sent_msgs.length).to.be.equal(2)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id0'],
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(sent_msgs[1][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id1'],
        return_type: 'promise'
      })
      expect(sent_msgs[1][1].length).to.be.equal(0)
    })
    it('registers handler and returns async', async () => {
      // Used to make sure promise is not pre-resolved
      let then_done: boolean = false
      let error: boolean = false
      const promise = c.call(['net', 'kb1rd', 'hello'], []).then(
        () => (then_done = true),
        () => (then_done = error = true)
      )

      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(typeof c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      )).to.be.equal('function')

      expect(then_done).to.be.false
      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [])
      await promise
      expect(then_done).to.be.true
      expect(error).to.be.false
    })
    it('resolves promise with return values', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], 'hello', undefined)
      const data = await promise
      expect(data).to.be.equal('hello')
    })
    it('rejects promise with second error argument', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, 'ERROR!')
      let error: any
      try {
        await promise
      } catch(e) {
        error = e
      }
      expect(error).to.be.equal('ERROR!')
    })
    it('rejects promise if callback called with other channel', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(new RpcChannel(() => undefined), [])
      let error: any
      try {
        await promise
      } catch(e) {
        error = e
      }
      expect(error).to.be.an.instanceOf(InvalidChannelError)
    })
    it('rejects promise with ForwardedError if error passed', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, { name: 'ERROR!' })
      let error: any
      try {
        await promise
      } catch(e) {
        error = e
      }
      expect(error).to.be.an.instanceOf(ForwardedError)
      expect(error.name).to.be.equal('ERROR!')
    })
    it('rejects promise if channel closed', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      c.close()
      let error: any
      try {
        await promise
      } catch(e) {
        error = e
      }
      expect(() => { throw error }).to.throw('Channel closed')
    })
  })
  describe('generate', () => {
    beforeEach(() => c.start())
    it('defaults to empty args', () => {
      c.generate(['net', 'kb1rd', 'hello'])
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'generator'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('passes args to `send`', async () => {
      c.generate(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'generator'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('generates a unique `return_addr`', () => {
      c.generate(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      c.generate(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(2)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id0'],
        return_type: 'generator'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(sent_msgs[1][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id1'],
        return_type: 'generator'
      })
      expect(sent_msgs[1][1].length).to.be.equal(0)
    })
    it('registers handler and returns async', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'generator'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(typeof c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      )).to.be.equal('function')

      let val = gen.next()
      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [])
      await val

      val = gen.next()
      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [])
      await val
    })
    it('resolves promise with return values', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], 'hello', undefined)
      const data = await gen.next()
      expect(data.value).to.be.equal('hello')
      expect(data.done).to.be.equal(false)
    })
    it('finishes if done signal sent', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, undefined, true)
      const data = await gen.next()
      expect(data.done).to.be.equal(true)
    })
    it('stops generator if `return` called', () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      gen.return()
      expect(sent_msgs.length).to.be.equal(2)
      const raddr = sent_msgs[0][0].return_addr as MultistringAddress
      expect(sent_msgs[1][0].to).to.be.deep.equal(['_', 'stopgen', ...raddr])
      expect(c._i_reg.map.get(raddr)).to.be.undefined
    })
    it('stops generator if `throw` called', () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      gen.throw('hi')
      expect(sent_msgs.length).to.be.equal(2)
      const raddr = sent_msgs[0][0].return_addr as MultistringAddress
      expect(sent_msgs[1][0].to).to.be.deep.equal(['_', 'stopgen', ...raddr])
      expect(c._i_reg.map.get(raddr)).to.be.undefined
    })
    it('unregisters on completion', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, undefined, true)
      const data = await gen.next()
      expect(data.done).to.be.equal(true)
      expect(
        c._i_reg.map.get(sent_msgs[0][0].return_addr as MultistringAddress)
      ).to.be.undefined
    })
    it('rejects promise and finishes with second error argument', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, 'ERROR!')
      let error: any
      try {
        await gen.next()
      } catch(e) {
        error = e
      }
      expect(error).to.be.equal('ERROR!')
      expect((await gen.next()).done).to.be.true
    })
    it('rejects promise if callback called with other channel', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(new RpcChannel(() => undefined), [])
      let error: any
      try {
        await gen.next()
      } catch(e) {
        error = e
      }
      expect(error).to.be.an.instanceOf(InvalidChannelError)
    })
    it('rejects promise with ForwardedError if error passed', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], undefined, { name: 'ERROR!' })
      let error: any
      try {
        await gen.next()
      } catch(e) {
        error = e
      }
      expect(error).to.be.an.instanceOf(ForwardedError)
      expect(error.name).to.be.equal('ERROR!')
    })
    it('finishes if channel closed', async () => {
      const gen = c.generate(['net', 'kb1rd', 'hello'], [])

      c.close()
      const data = await gen.next()
      expect(data.done).to.be.equal(true)
    })
  })
  describe('call_obj', () => {
    beforeEach(() => c.start())
    it('passes args to `send`', () => {
      c.call_obj.net.kb1rd
        .hello(123, 'abc', { [toRpcSerialized]: () => 'hi' })
        .catch(() => undefined)
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: sent_msgs[0][0].return_addr,
        return_type: 'promise'
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('resolves promise with return values', async () => {
      const promise = c.call_obj.net.kb1rd.hello()

      ;(c._i_reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], 'hello', undefined)
      const data = await promise
      expect(data).to.be.equal('hello')
    })
    it('returns undefined if accessor not string', () => {
      expect(c.call_obj[(Symbol() as unknown) as string]).to.be.undefined
    })
  })
  /* describe('clearPolicy', () => {
    it('removes already set security policy', () => {
      c.setPolicy(['yeet'], AccessPolicy.DENY)
      c.clearPolicy(['yeet'])
      // Clear default
      c.clearPolicy([])
      expect(c.access.get(['yeet'])).to.be.undefined
    })
  }) */
  describe('receive', () => {
    beforeEach(() => c.start())
    it('calls function with arguments', () => {
      let called = false
      let error: Error | undefined = undefined
      c.register(['net', 'kb1rd', 'test'], (chan, wc, a, b) => {
        called = true
        // Errors are caught in handlers. Pass them up
        try {
          expect(chan).to.be.equal(c)
          expect(wc.length).to.be.equal(0)
          expect(a).to.be.equal('hello')
          expect(b).to.be.equal(123)
        } catch(e) {
          e = error
        }
      })
      c.receive({
        to: ['net', 'kb1rd', 'test'],
        args: ['hello', 123]
      })
      expect(called).to.be.true
      if (error) {
        throw error
      }
    })
    it('does nothing if channel stopped', () => {
      c.stop()
      let called = false
      c.on('rawmessage', () => (called = true))
      c.receive({
        to: ['net', 'kb1rd', 'test'],
        args: ['hello', 123]
      })
      expect(called).to.be.false
    })
    describe('promise return', () => {
      it('`send`s return value', () => {
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          // In reality, schemas would provide runtime type checking
          return (a as string) + (b as number)
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: ['hello123', undefined],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s error', () => {
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          throw new TypeError('yeet')
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'TypeError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'yeet',
              stack: 'Stack trace redacted for security reasons'
            }
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s async return value', async () => {
        let promise: Promise<string> | undefined = undefined
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          // In reality, schemas would provide runtime type checking
          promise = Promise.resolve((a as string) + (b as number))
          return promise
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        await promise
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: ['hello123', undefined],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s async first generator value', async () => {
        c.register(['net', 'kb1rd', 'add'], async function*(chan, wc, a, b) {
          // In reality, schemas would provide runtime type checking
          yield (a as string) + (b as number)
          yield 3
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        // This code will finish executing before the generator promise is
        // resolved, so this is a dirty hack to get around that
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: ['hello123', undefined],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s async first generator error', async () => {
        c.register(['net', 'kb1rd', 'add'], async function*(chan, wc, a, b) {
          throw 'error'
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        // This code will finish executing before the generator promise is
        // resolved, so this is a dirty hack to get around that
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [undefined, 'error'],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s async error', async () => {
        let promise: Promise<string> | undefined = undefined
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          promise = Promise.reject(new TypeError('yeet'))
          return promise
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return']
        })
        try {
          await promise
        } catch(e) {}
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'TypeError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'yeet',
              stack: 'Stack trace redacted for security reasons'
            }
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s error if function undefined', () => {
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return']
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'TypeError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'Function at address is undefined',
              stack: 'Stack trace redacted for security reasons'
            }
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s error if access denied BEFORE getting function', () => {
        c.access_controller = new FunctionAccessController((addr) => {
          expect(addr).to.be.deep.equal(['net', 'kb1rd', 'test'])
          return false
        })
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return']
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'AccessDeniedError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'Access denied',
              stack: 'Stack trace redacted for security reasons'
            }
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s error if registry denies access', () => {
        c._i_reg.access_chain.push(new FunctionAccessController((addr) => {
          expect(addr).to.be.deep.equal(['net', 'kb1rd', 'test'])
          return false
        }))
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return']
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'AccessDeniedError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'Access denied',
              stack: 'Stack trace redacted for security reasons'
            }
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
    })
    describe('generator return', () => {
      it('`send`s error', () => {
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          throw new TypeError('yeet')
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return'],
          return_type: 'generator'
        })
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'TypeError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'yeet',
              stack: 'Stack trace redacted for security reasons'
            },
            true
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s return value, then finishes for basic', () => {
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          // In reality, schemas would provide runtime type checking
          return (a as string) + (b as number)
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return'],
          return_type: 'generator'
        })
        expect(sent_msgs.length).to.be.equal(2)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: ['hello123', undefined, false],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
        expect(sent_msgs[1][0]).to.be.deep.equal({
          to: ['return'],
          args: [undefined, undefined, true],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[1][1].length).to.be.equal(0)
      })
      it('`send`s return value, then finishes for promise', async () => {
        let promise: Promise<string> | undefined = undefined
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          // In reality, schemas would provide runtime type checking
          promise = Promise.resolve((a as string) + (b as number))
          return promise
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return'],
          return_type: 'generator'
        })
        await promise
        expect(sent_msgs.length).to.be.equal(2)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: ['hello123', undefined, false],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
        expect(sent_msgs[1][0]).to.be.deep.equal({
          to: ['return'],
          args: [undefined, undefined, true],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[1][1].length).to.be.equal(0)
      })
      it('`send`s error for promise', async () => {
        let promise: Promise<string> | undefined = undefined
        c.register(['net', 'kb1rd', 'add'], (chan, wc, a, b) => {
          // In reality, schemas would provide runtime type checking
          promise = Promise.reject(new TypeError('yeet'))
          return promise
        })
        c.receive({
          to: ['net', 'kb1rd', 'add'],
          args: ['hello', 123],
          return_addr: ['return'],
          return_type: 'generator'
        })
        try {
          await promise
        } catch(e) {}
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            {
              name: 'TypeError',
              columnNumber: undefined,
              fileName: undefined,
              lineNumber: undefined,
              message: 'yeet',
              stack: 'Stack trace redacted for security reasons'
            },
            true
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('`send`s multiple data values, then finishes', async () => {
        c.register(['net', 'kb1rd', 'test'], async function*(chan, wc, a, b) {
          yield 'a'
          yield 'b'
          yield 'c'
        })
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return'],
          return_type: 'generator'
        })
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(4)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'a',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
        expect(sent_msgs[1][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'b',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[1][1].length).to.be.equal(0)
        expect(sent_msgs[2][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'c',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[2][1].length).to.be.equal(0)
        expect(sent_msgs[3][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            undefined,
            true
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[3][1].length).to.be.equal(0)
      })
      it('responds to stop handler', async () => {
        let on_stop: () => void
        let stop_promise = new Promise((r) => (on_stop = r))
        c.register(['net', 'kb1rd', 'test'], async function*(chan, wc, a, b) {
          yield 'a'
          on_stop()
          yield 'b'
          yield 'c'
        })
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return'],
          return_type: 'generator'
        })
        await stop_promise
        c.receive({
          to: ['_', 'stopgen', 'return'],
          args: []
        })
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(1)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'a',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
      })
      it('ends on error, then stops', async () => {
        c.register(['net', 'kb1rd', 'test'], async function*(chan, wc, a, b) {
          yield 'a'
          throw 'b'
          yield 'c'
        })
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return'],
          return_type: 'generator'
        })
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(2)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'a',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
        expect(sent_msgs[1][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            'b',
            true
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[1][1].length).to.be.equal(0)
      })
      it('unregisters `stopgen` channel when stopped', async () => {
        c.register(['net', 'kb1rd', 'test'], async function*(chan, wc, a, b) {
          yield 'a'
        })
        c.receive({
          to: ['net', 'kb1rd', 'test'],
          args: [],
          return_addr: ['return'],
          return_type: 'generator'
        })
        await new Promise((res) => setTimeout(res, static_await_delay))
        expect(sent_msgs.length).to.be.equal(2)
        expect(sent_msgs[0][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            'a',
            undefined,
            false
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[0][1].length).to.be.equal(0)
        expect(sent_msgs[1][0]).to.be.deep.equal({
          to: ['return'],
          args: [
            undefined,
            undefined,
            true
          ],
          return_addr: undefined,
          return_type: 'promise'
        })
        expect(sent_msgs[1][1].length).to.be.equal(0)
        expect(c.reg.map.get(['_', 'stopgen', 'return'])).to.be.undefined
      })
    })
  })
})