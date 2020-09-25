export const toRpcSerialized = Symbol('ChannelRpcSerialize')

type Primitive = undefined | null | void | boolean | number | string | BigInt

type SerializableArray = SerializableData[]
type SerializationFuncObject = { [toRpcSerialized]: SerializationFunction }
type SerializableObject =
  | { [key: string]: SerializableData }
  | SerializationFuncObject
export type SerializableData =
  | Primitive
  | SerializableArray
  | SerializableObject
  | Transferable
  | Error

type SerializedArray = SerializedData[]
type SerializedObject = { [key: string]: SerializedData }
export type SerializedData =
  | Primitive
  | SerializedArray
  | SerializedObject
  | Transferable

type SerializationFunction = (
  data: SerializableData,
  xfer: Transferable[]
) => SerializedData

/**
 * Javascript will throw errors if I do a simple defined check, so all of this
 * crap is to ensure that doesn't happen. It would be nice to put this in a
 * function, but then JS would throw the error. So, all of this typed out crap
 * is actually necessary.
 */
const transferrables = [
  typeof MessagePort !== 'undefined' && MessagePort,
  typeof ImageBitmap !== 'undefined' && ImageBitmap,
  typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas,

  typeof ArrayBuffer !== 'undefined' && ArrayBuffer,

  typeof Int8Array !== 'undefined' && Int8Array,
  typeof Int16Array !== 'undefined' && Int16Array,
  typeof Int32Array !== 'undefined' && Int32Array,
  typeof BigInt64Array !== 'undefined' && BigInt64Array,

  typeof Uint8Array !== 'undefined' && Uint8Array,
  typeof Uint8ClampedArray !== 'undefined' && Uint8ClampedArray,
  typeof Uint16Array !== 'undefined' && Uint16Array,
  typeof Uint32Array !== 'undefined' && Uint32Array,
  typeof BigUint64Array !== 'undefined' && BigUint64Array,

  typeof Float32Array !== 'undefined' && Float32Array,
  typeof Float64Array !== 'undefined' && Float64Array
].filter((d) => d)

/**
 * Prepares `data` to be sent over a MessagePort by ensuring that all data is
 * of a type that can be sent and that all transferrables are `push`ed to
 * `xfer`.
 * @todo Make error stack sending configurable
 * @param data Data to serialize
 * @param xfer Destination array for transferrables
 * @returns The data in serialized format
 */
export function rpcSerialize(
  data: SerializableData,
  xfer: Transferable[]
): SerializedData {
  if (data && (data as SerializationFuncObject)[toRpcSerialized]) {
    return (data as SerializationFuncObject)[toRpcSerialized](data, xfer)
  }
  switch (typeof data) {
    case 'undefined':
    case 'bigint':
    case 'boolean':
    case 'number':
    case 'string':
      return data
    case 'symbol':
      throw new TypeError('Symbols cannot be serialized')
    case 'function':
      throw new TypeError('Functions cannot be serialized')
    case 'object':
      // Null is an object... I guess
      if (data === null) {
        return null
      }
      if (
        transferrables.some(
          (type) => data instanceof ((type as unknown) as () => void)
        )
      ) {
        xfer.push(data as Transferable)
        return data as SerializedData
      }
      if (data instanceof Error) {
        return {
          name: data.name,
          message: data.message,
          stack: 'Stack trace redacted for security reasons',
          // These don't exist in the TS definitions, but they may exist in
          // other runtime environments
          columnNumber: ((data as unknown) as { columnNumber: number })
            .columnNumber,
          lineNumber: ((data as unknown) as { lineNumber: number }).lineNumber,
          fileName: ((data as unknown) as { fileName: number }).fileName
        }
      }
      if (Array.isArray(data)) {
        return data.map((e) => rpcSerialize(e, xfer))
      }
      const robj: SerializedObject = {}
      Object.keys(data as SerializedObject).forEach((k) => {
        robj[k] = rpcSerialize((data as SerializedObject)[k], xfer)
      })
      return robj
    default:
      throw new TypeError(`Cannot serialize unknown type ${typeof data}`)
  }
}
