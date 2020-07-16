import { expect } from 'chai'
import {
  toRpcSerialized,
  rpcSerialize,
  InvalidChannelError,
  AccessDeniedError,
  ForwardedError,
  AccessPolicy,
  RpcChannel,
  RpcMessage,
  RpcRemappedFunction,
  RpcAddress,
  RemapArguments,
  RpcFunctionAddress,
  SerializableData,
  SerializedData,
  BaseRegisteredObject,
  RpcFunction,
  RpcHandlerRegistry,
  MultistringAddress
} from '../src/index'

describe('[core.ts] rpcSerialize', () => {
  it('defaults to serialization function if present', () => {
    const obj = {
      tons: 'of',
      properties: true,
      [toRpcSerialized](): string {
        return 'hi'
      }
    }
    const xfer: Transferable[] = []
    expect(rpcSerialize(obj, xfer)).to.be.equal('hi')
    expect(xfer.length).to.be.equal(0)
  })
  it('passes through basic types', () => {
    const xfer: Transferable[] = []
    const bi = BigInt(9007199254740991)
    expect(rpcSerialize(undefined, xfer)).to.be.equal(undefined)
    expect(rpcSerialize(bi, xfer)).to.be.equal(bi)
    expect(rpcSerialize(true, xfer)).to.be.equal(true)
    expect(rpcSerialize(1, xfer)).to.be.equal(1)
    expect(rpcSerialize('test', xfer)).to.be.equal('test')
    expect(xfer.length).to.be.equal(0)
  })
  it('throws error when given symbol', () => {
    expect(() => {
      rpcSerialize((Symbol('Test') as unknown) as number, [])
    }).to.throw('Symbols cannot be serialized')
  })
  it('throws error when given function', () => {
    expect(() => {
      rpcSerialize(((() => undefined) as unknown) as number, [])
    }).to.throw('Functions cannot be serialized')
  })
  it('adds transferables', () => {
    const true_xfer = [
      // TS doesn't like this?
      // new MessageChannel().port1,
      new ArrayBuffer(2),

      // Not supported in NodeJS, AFAIK
      // new ImageBitmap()
      // new OffscreenCanvas(256, 256)

      new Int8Array(2),
      new Int16Array(2),
      new Int32Array(2),
      new BigInt64Array(2),

      new Uint8Array(2),
      new Uint8ClampedArray(2),
      new Uint16Array(2),
      new Uint32Array(2),
      new BigUint64Array(2),

      new Float32Array(2),
      new Float64Array(2)
    ]

    const xfer: Transferable[] = []
    true_xfer.forEach((x) => {
      expect(rpcSerialize(x, xfer)).to.be.equal(x)
    })

    expect(xfer.length).to.be.equal(true_xfer.length)
    true_xfer.forEach((x, i) => {
      expect(xfer[i]).to.be.equal(x)
    })
  })
  it('gets error data', () => {
    const result = rpcSerialize(new TypeError('yeet'), [])
    expect(result).to.be.deep.equal({
      name: 'TypeError',
      message: 'yeet',
      stack: 'Stack trace redacted for security reasons',
      columnNumber: undefined,
      fileName: undefined,
      lineNumber: undefined
    })
  })
  it('recursively maps array elements', () => {
    const obj = {
      tons: 'of',
      properties: true,
      [toRpcSerialized](): string {
        return 'hi'
      }
    }
    const ab = new ArrayBuffer(2)
    const xfer: Transferable[] = []
    const result = rpcSerialize([obj, ab], xfer)

    expect((result as SerializedData[]).length).to.be.equal(2)
    expect((result as SerializedData[])[0]).to.be.equal('hi')
    expect((result as SerializedData[])[1]).to.be.equal(ab)

    expect(xfer.length).to.be.equal(1)
    expect(xfer[0]).to.be.equal(ab)
  })
  it('recursively maps object properties', () => {
    const obj = {
      tons: 'of',
      properties: true,
      [toRpcSerialized](): string {
        return 'hi'
      }
    }
    const ab = new ArrayBuffer(2)
    const xfer: Transferable[] = []
    const result = rpcSerialize({ obj, ab }, xfer)

    expect(result).to.be.deep.equal({ obj: 'hi', ab })

    expect(xfer.length).to.be.equal(1)
    expect(xfer[0]).to.be.equal(ab)
  })
})

describe('[core.ts] RpcAddress', () => {
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

describe('[core.ts] RpcHandlerRegistry', () => {
  it('nextSeqAddr allocates sequential return addresses', () => {
    const hr = new RpcHandlerRegistry()
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id0'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id1'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id2'])
    expect(hr.nextSeqAddr()).to.be.deep.equal(['_', 'ret', 'id3'])
  })
})

describe('[core.ts] RpcChannel', () => {
  // Register already tested via AddressMap. I know, UNIT testing, but I'm lazy
  let c: RpcChannel
  let sent_msgs: [RpcMessage, Transferable[]][]
  beforeEach(() => {
    sent_msgs = []
    c = new RpcChannel((msg, xfer) => sent_msgs.push([msg, xfer]))
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
    @RemapArguments(['pass', 'pass'], 'rm')
    remapped_pass(a: string, b: string): string {
      return a + b
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
  })
  describe('register', () => {
    it('basic register', () => {
      const func = () => undefined
      c.register(['net', 'kb1rd', 'test'], func)
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.equal(func)
    })
    it('register from remapped function key', () => {
      const func = () => undefined
      const func2 = () => undefined
      func[RpcRemappedFunction] = func2

      c.register(['net', 'kb1rd', 'test'], func)
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.equal(func2)
    })
  })
  describe('unregister', () => {
    it('unregister by address', () => {
      const func = () => undefined
      c.register(['net', 'kb1rd', 'test'], func)
      c.unregister(['net', 'kb1rd', 'test'])
      expect(c.reg.map.get(['net', 'kb1rd', 'test'])).to.be.undefined
    })
  })
  describe('registerAll', () => {
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
  })
  describe('unregisterAll', () => {
    it('unregisters endpoints', () => {
      c.registerAll(new Test() as {})
      c.unregisterAll(new Test() as {})
      expect(c.reg.map.get(['net', 'kb1rd', 'literally'])).to.be.undefined
      expect(c.reg.map.get(['net', 'kb1rd', 'anything'])).to.be.undefined
    })
  })
  describe('send', () => {
    it('serializes arguments', () => {
      c.send(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: undefined
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
        return_addr: ['net', 'kb1rd', 'callreturn']
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
  })
  describe('call', () => {
    it('passes args to `send`', () => {
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: sent_msgs[0][0].return_addr
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('generates a unique `return_addr`', () => {
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      c.call(
        ['net', 'kb1rd', 'hello'],
        [123, 'abc', { [toRpcSerialized]: () => 'hi' }]
      )
      expect(sent_msgs.length).to.be.equal(2)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id0']
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(sent_msgs[1][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: ['_', 'ret', 'id1']
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
        return_addr: sent_msgs[0][0].return_addr
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
      expect(
        typeof c.reg.map.get(sent_msgs[0][0].return_addr as MultistringAddress)
      ).to.be.equal('function')

      expect(then_done).to.be.false
      ;(c.reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [])
      await promise
      expect(then_done).to.be.true
      expect(error).to.be.false
    })
    it('resolves promise with return values', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c.reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], 'hello', undefined)
      const data = await promise
      expect(data).to.be.equal('hello')
    })
    it('rejects promise with second error argument', async () => {
      const promise = c.call(['net', 'kb1rd', 'hello'], [])

      ;(c.reg.map.get(
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

      ;(c.reg.map.get(
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

      ;(c.reg.map.get(
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
  })
  describe('call_obj', () => {
    it('passes args to `send`', () => {
      c.call_obj.net.kb1rd.hello(123, 'abc', { [toRpcSerialized]: () => 'hi' })
      expect(sent_msgs.length).to.be.equal(1)
      expect(sent_msgs[0][0]).to.be.deep.equal({
        to: ['net', 'kb1rd', 'hello'],
        args: [123, 'abc', 'hi'],
        return_addr: sent_msgs[0][0].return_addr
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('resolves promise with return values', async () => {
      const promise = c.call_obj.net.kb1rd.hello()

      ;(c.reg.map.get(
        sent_msgs[0][0].return_addr as MultistringAddress
      ) as RpcFunction)(c, [], 'hello', undefined)
      const data = await promise
      expect(data).to.be.equal('hello')
    })
    it('returns undefined if accessor not string', () => {
      expect(c.call_obj[(Symbol() as unknown) as string]).to.be.undefined
    })
  })
  describe('clearPolicy', () => {
    it('removes already set security policy', () => {
      c.setPolicy(['yeet'], AccessPolicy.DENY)
      c.clearPolicy(['yeet'])
      // Clear default
      c.clearPolicy([])
      expect(c.access.get(['yeet'])).to.be.undefined
    })
  })
  describe('receive', () => {
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
        return_addr: undefined
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
        return_addr: undefined
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
        return_addr: undefined
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
        return_addr: undefined
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
        return_addr: undefined
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
    it('`send`s error if access denied BEFORE getting function', () => {
      c.setPolicy(['net', 'kb1rd', undefined], AccessPolicy.DENY)
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
        return_addr: undefined
      })
      expect(sent_msgs[0][1].length).to.be.equal(0)
    })
  })
})