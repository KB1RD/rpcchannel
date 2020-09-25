import { expect } from 'chai'
import {
  toRpcSerialized,
  rpcSerialize,
  SerializedData
} from '../src/index'

describe('[serializer.ts] rpcSerialize', () => {
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
    expect(rpcSerialize(null, xfer)).to.be.equal(null)
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