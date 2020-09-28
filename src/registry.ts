/**
 * @author Nathan Pennie <kb1rd@kb1rd.net>
 */
/** */

import {
  MultistringAddress,
  WildcardMultistringAddress,
  AddressMap
} from './addrmap'
import {
  ChainedAccessController,
  AccessPolicy,
  AccessController,
  OptAccessPolicy,
  CanCallFunction,
  RequiresPermissions,
  PermissionedAccessCanFunction
} from './accesscontrol'
import { rpcSerialize, SerializableData, SerializedData } from './serializer'
import { isDefined } from './utils'

export const RpcFunctionAddress = Symbol('RpcFunctionAddress')
export const RpcRemappedFunction = Symbol('RpcRemappedFunction')

interface WithValidAddressKey {
  [RpcFunctionAddress]?: WildcardMultistringAddress
}

type RpcResult =
  | SerializableData
  | Promise<SerializableData>
  | AsyncGenerator<SerializableData, void, void>

/**
 * A destination function for Remote Procedure Calls (RPCs).
 * @param src The source `RpcChannel`
 * @param wildcards Any wildcards that were used in resolution of this function
 */
export interface RpcFunction extends WithValidAddressKey {
  (src: RpcChannel, wildcards: string[], ...args: SerializedData[]): RpcResult
  [RpcRemappedFunction]?: RpcFunction
  [CanCallFunction]?: PermissionedAccessCanFunction
  [RequiresPermissions]?: Iterable<string>
}

export function RpcAddress(address: WildcardMultistringAddress) {
  return function (
    // eslint-disable-next-line
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): void {
    const func = descriptor.value
    if (typeof func !== 'function') {
      throw new TypeError('Cannot mark non-function as RPC function')
    }
    func[RpcFunctionAddress] = address
  }
}

export function RemapArguments(
  mapping: ('pass' | 'drop' | 'expand')[],
  key: string | symbol | number = RpcRemappedFunction
) {
  return function (
    // eslint-disable-next-line
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const func = descriptor.value
    if (typeof func !== 'function') {
      throw new TypeError('Cannot remap arguments for non-function')
    }
    // eslint-disable-next-line
    descriptor.value[key as string] = function(...args: any[]) {
      const it = mapping[Symbol.iterator]()
      let value: string | undefined = undefined
      return func.apply(
        this,
        args.flatMap((v) => {
          if (!value) {
            ;({ value } = it.next())
          }
          switch (value) {
            default:
            case 'pass':
              value = undefined
              return [v]
            case 'drop':
              value = undefined
              return []
            case 'expand':
              // eslint-disable-next-line
              const array: any[] = []
              if (!v[Symbol.iterator]) {
                throw new TypeError('Attempted to expand non-iterable')
              }
              const exp_it = v[Symbol.iterator]()
              do {
                const r = exp_it.next()
                if (r.done) {
                  throw new TypeError('Expand reached end of array')
                }
                array.push(r.value)
              } while (({ value } = it.next()).value === 'expand')
              return array
          }
        })
      )
    }
    return descriptor
  }
}

/**
 * Sent between threads/workers/tabs/domains/whatever to carry RPCs and
 * associated data.
 */
export interface RpcMessage {
  to: MultistringAddress
  args: SerializedData[]
  return_addr?: MultistringAddress
  return_type?: 'promise' | 'generator'
}

export namespace RpcMessage {
  export const Schema = {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' } },
      args: { type: 'array' },
      return_addr: { type: 'array', items: { type: 'string' } },
      return_type: { type: 'string', enum: ['promise', 'generator'] }
    },
    required: ['to', 'args']
  }
}

export type BaseRegisteredObject = { [key: string]: WithValidAddressKey }

/**
 * Anything where RPC functions can be registered and unregistered.
 */
interface HandleRegistry {
  /**
   * Registers a handler for incoming data
   * @param address Address for the handle
   * @param func Function to call when triggered
   */
  register(address: WildcardMultistringAddress, func: RpcFunction): void
  /**
   * Unregisters a handler for incoming data
   * @param address Address for the handle
   */
  unregister(address: WildcardMultistringAddress): void
  /**
   * Registers member functions of a class (marked with the `RpcAddress`
   * decorator)
   */
  registerAll(obj: BaseRegisteredObject): void
  /**
   * Unregisters member functions of a class (marked with the `RpcAddress`
   * decorator). Note that if any functions were removed from the class after
   * it was registered, those will not be unregistered.
   */
  unregisterAll(obj: BaseRegisteredObject): void
}

/**
 * Where RPC handles are registered to a particular address. This can be
 * re-used between different `RpcChannel`s.
 */
export class RpcHandlerRegistry
  extends ChainedAccessController
  implements HandleRegistry {
  map: AddressMap<RpcFunction> = new AddressMap()
  return_seq_id = 0

  constructor() {
    super(undefined)
  }

  register(address: WildcardMultistringAddress, func: RpcFunction): void {
    while (func[RpcRemappedFunction]) {
      func = func[RpcRemappedFunction] as RpcFunction
    }
    this.map.put(address, func)
  }
  unregister(address: WildcardMultistringAddress): void {
    this.map.put(address, undefined)
  }
  registerAll(base: BaseRegisteredObject): void {
    let obj = base
    // Based on https://stackoverflow.com/a/31055217/7853604
    do {
      for (const k of Object.getOwnPropertyNames(obj)) {
        const func = obj[k] as RpcFunction
        if (func && func[RpcFunctionAddress] && typeof func === 'function') {
          let tgt = func
          while (tgt[RpcRemappedFunction]) {
            tgt = tgt[RpcRemappedFunction] as RpcFunction
          }
          this.register(
            func[RpcFunctionAddress] as WildcardMultistringAddress,
            // eslint-disable-next-line
            (...args: any) => tgt.apply(base, args)
          )
        }
      }
    } while ((obj = Object.getPrototypeOf(obj)))
  }
  unregisterAll(base: BaseRegisteredObject): void {
    let obj = base
    // Based on https://stackoverflow.com/a/31055217/7853604
    do {
      for (const k of Object.getOwnPropertyNames(obj)) {
        const func = obj[k]
        if (func && func[RpcFunctionAddress] && typeof func === 'function') {
          this.unregister(
            func[RpcFunctionAddress] as WildcardMultistringAddress
          )
        }
      }
    } while ((obj = Object.getPrototypeOf(obj)))
  }

  nextSeqAddr(): MultistringAddress {
    return ['_', 'ret', `id${this.return_seq_id++}`]
  }
}

export interface RpcAccessor {
  (...args: SerializableData[]): Promise<SerializedData>
  [key: string]: RpcAccessor
}

/**
 * Thrown when a return from a function call reaches a different RpcChannel
 * than it was sent from. This **may** indicate a security issue due to re-used
 * recieve callbacks.
 */
export class InvalidChannelError extends Error {
  readonly name = 'InvalidChannelError'
}

export class AccessDeniedError extends Error {
  readonly name = 'AccessDeniedError'
}

export class ForwardedError extends Error {}

/**
 * A wrapper class for functions to perform remote procedure calls.
 */
export class RpcChannel implements HandleRegistry, AccessController {
  readonly _i_reg: RpcHandlerRegistry = new RpcHandlerRegistry()
  access_controller?: AccessController = new ChainedAccessController(undefined)
  /**
   * @param c_send The function to send over whatever transport is used.
   * @param reg The handle registry. This can be changed later.
   */
  constructor(
    protected readonly c_send: (msg: RpcMessage, xfer: Transferable[]) => void,
    protected readonly default_policy = AccessPolicy.ALLOW,
    public reg: RpcHandlerRegistry = new RpcHandlerRegistry()
  ) {}

  register(address: WildcardMultistringAddress, func: RpcFunction): void {
    this.reg.register(address, func)
  }
  unregister(address: WildcardMultistringAddress): void {
    this.reg.unregister(address)
  }
  registerAll(obj: BaseRegisteredObject): void {
    this.reg.registerAll(obj)
  }
  unregisterAll(obj: BaseRegisteredObject): void {
    this.reg.unregisterAll(obj)
  }

  can(
    addr: MultistringAddress,
    opts: { args: SerializableData[], channel: RpcChannel, func?: RpcFunction }
  ): OptAccessPolicy {
    let val = this.access_controller && this.access_controller.can(addr, opts)
    if (isDefined(val)) {
      return val
    }
    val = this._i_reg.can(addr, opts)
    if (isDefined(val)) {
      return val
    }
    return this.default_policy
  }

  /**
   * Sends data to a particular handle. Because there is no `await` for the
   * other side to process this, the `send` function should be used for pushing
   * data only since multiple messages may be sent before the other side gets
   * around to processing them.
   * @param to Address to send data to
   * @param args Data to send
   * @param return_addr The address of the return field. This is used for full
   * transactions, such as function calls
   */
  send(
    to: MultistringAddress,
    args: SerializableData[] = [],
    return_addr?: MultistringAddress,
    return_type: 'promise' | 'generator' = 'promise'
  ): void {
    const xfer: Transferable[] = []
    const msg = {
      to,
      args: args.map((d) => rpcSerialize(d, xfer)),
      return_addr,
      return_type
    }
    this.c_send(msg, xfer)
  }

  /**
   * Calls a handle and awaits the return value.
   * @param to Handle to call
   * @param args Arguments to pass through
   * @returns A promise that will return when the call is completed.
   */
  call(
    to: MultistringAddress,
    args: SerializableData[] = []
  ): Promise<SerializedData> {
    const return_addr = this._i_reg.nextSeqAddr()
    return new Promise((resolve, reject) => {
      this._i_reg.register(return_addr, (channel, wc, data, error) => {
        if (channel !== this) {
          reject(
            new InvalidChannelError(
              'Return value was sent through the wrong channel'
            )
          )
        } else if (error) {
          if ((error as { name: string }).name) {
            reject(Object.assign(new ForwardedError(), error))
          } else {
            reject(error)
          }
        } else {
          resolve(data as SerializedData)
        }
        this.unregister(return_addr)
      })
      this.send(to, args, return_addr)
    })
  }

  /**
   * Returns an async generator. This supports only `yield`ing values: ATM,
   * returned values and `yield`ed arguments are not supported. **You also must
   * manually deallocate the generator once you're done!** Yes, manual memory
   * management. If you don't manually deallocate, the listeners on both ends
   * will remain allocated leading to memory leaks. To deallocate, call the
   * `return` or `throw` functions on the generator.
   */
  generate(
    to: MultistringAddress,
    args: SerializableData[] = []
  ): AsyncGenerator<SerializedData, void, void> {
    const return_addr = this._i_reg.nextSeqAddr()

    this.send(to, args, return_addr, 'generator')

    // Now, create the generator. If this wasn't done, the above code would
    // only be run when `next` was called
    const buffer: [SerializedData, SerializedData | Error, boolean][] = []
    let onNewData: (() => void) | undefined

    const onDone = () => this._i_reg.unregister(return_addr)
    this._i_reg.register(return_addr, (channel, wc, data, error, done) => {
      if (channel !== this) {
        onDone()
        buffer.push([
          undefined,
          new InvalidChannelError(
            'Yield value was sent through the wrong channel'
          ),
          true
        ])
      } else {
        if (error) {
          onDone()
        }
        if ((error as { name: string })?.name) {
          buffer.push([
            data,
            Object.assign(new ForwardedError(), error),
            Boolean(done)
          ])
        } else {
          buffer.push([data, error, Boolean(done)])
        }
      }
      if (onNewData) {
        onNewData()
      }
    })

    const getNext = async (): Promise<
      [SerializedData, SerializedData | Error, boolean]
    > => {
      if (!buffer.length) {
        await new Promise((res) => (onNewData = res))
        onNewData = undefined
      }
      return buffer.shift() as [SerializedData, SerializedData | Error, boolean]
    }

    const gen = (async function* () {
      while (true) {
        const [d, e, c] = await getNext()
        if (e) {
          onDone()
          throw e
        } else if (c) {
          onDone()
          return
        } else {
          yield d
        }
      }
    })()

    const stop = (): void => {
      this.send(['_', 'stopgen', ...return_addr], [])
      onDone()
    }

    const original_return = gen.return
    const original_throw = gen.throw
    return Object.assign(gen, {
      return(): Promise<IteratorResult<SerializableData, void>> {
        stop()
        return original_return.apply(gen, [undefined as void])
      },
      // eslint-disable-next-line
      throw(e: any): Promise<IteratorResult<SerializableData, void>> {
        stop()
        return original_throw.apply(gen, [e])
      }
    })
  }

  get call_obj(): RpcAccessor {
    function createRpcAccessor(
      addr: string[],
      oncall: (
        addr: string[],
        args: SerializableData[]
      ) => Promise<SerializedData>
    ): RpcAccessor {
      const dummyFunction = () => new Promise((r) => r())
      return new Proxy(dummyFunction as RpcAccessor, {
        apply(func, target, args: SerializableData[]) {
          return oncall(addr, args)
        },
        get(target, prop) {
          if (typeof prop !== 'string') {
            return undefined
          }
          return createRpcAccessor([...addr, prop], oncall)
        }
      })
    }
    return createRpcAccessor([], (addr, args) => this.call(addr, args))
  }

  /**
   * Call this when a new message is recieved to process it.
   * @param val Incoming message
   */
  receive(val: RpcMessage): void {
    type ItType = AsyncGenerator<SerializableData, void, void>
    const maybeReturn = (
      data?: SerializableData | Promise<SerializableData> | ItType,
      error?: SerializableData
    ): void => {
      // eslint-disable-next-line
      const isGenerator = (data: any): boolean => {
        return (
          data &&
          (data as ItType)[Symbol.asyncIterator] &&
          typeof (data as ItType).next === 'function'
        )
      }
      if (val.return_addr) {
        const addr = val.return_addr

        switch (val.return_type) {
          case 'generator':
            if (error) {
              this.send(addr, [undefined, error, true])
              return
            }

            let done = false
            const setDone = (): void => {
              done = true
              this.unregister(['_', 'stopgen', ...addr])
            }
            const send = (
              a: MultistringAddress,
              d: SerializableData,
              e: Error | undefined,
              set_done = false
            ): void => {
              if (!done) {
                this.send(a, [d, e, set_done || Boolean(e)])
              }
              if (e || set_done) {
                setDone()
              }
            }
            const registerStopHandler = (): void => {
              this._i_reg.register(['_', 'stopgen', ...addr], setDone)
            }

            if (data instanceof Promise) {
              data.then(
                (d) => {
                  send(addr, d, undefined, false)
                  send(addr, undefined, undefined, true)
                },
                (e) => send(addr, undefined, e)
              )
            } else if (isGenerator(data)) {
              registerStopHandler()
              ;(async function () {
                try {
                  for await (const d of data as ItType) {
                    send(addr, d, undefined, false)
                    if (done) {
                      return
                    }
                  }
                  send(addr, undefined, undefined, true)
                } catch (e) {
                  send(addr, undefined, e)
                }
              })()
            } else {
              send(addr, data as SerializableData, undefined, false)
              send(addr, undefined, undefined, true)
            }
            return
          default:
          case 'promise':
            if (error) {
              this.send(addr, [undefined, error])
              return
            }

            const sendPromise = (data: Promise<SerializableData>): void => {
              data.then(
                (d) => this.send(addr, [d, undefined]),
                (e) => this.send(addr, [undefined, e])
              )
            }
            if (data instanceof Promise) {
              sendPromise(data)
            } else if (isGenerator(data)) {
              sendPromise(
                new Promise((res, rej) =>
                  (data as ItType).next().then(
                    ({ value }) => res(value),
                    (err) => rej(err)
                  )
                )
              )
            } else {
              this.send(addr, [data as SerializableData, undefined])
            }
            return
        }
      }
    }

    const wc: string[] = []
    const func = this._i_reg.map.get(val.to, wc) || this.reg.map.get(val.to, wc)

    const security_policy = this.can(
      val.to,
      { args: val.args, channel: this, func }
    )
    if (isDefined(security_policy) && security_policy === AccessPolicy.DENY) {
      maybeReturn(
        undefined,
        (new AccessDeniedError('Access denied') as unknown) as SerializableData
      )
      return
    }

    if (!func) {
      maybeReturn(undefined, new TypeError('Function at address is undefined'))
      return
    }

    let data: RpcResult
    try {
      data = (func as RpcFunction)(this, wc, ...val.args)
    } catch (e) {
      maybeReturn(undefined, e)
      return
    }
    maybeReturn(data)
  }
}
