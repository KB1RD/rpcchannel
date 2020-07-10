import { expect } from 'chai'
import { EnforceArgumentSchema, EnforceMethodArgSchema } from '../src/schema'

describe('[schema.ts] schema validators', () => {
  describe('EnforceArgumentSchema', () => {
    it('passes to function w/o error', () => {
      const schema = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }]
      }
      const func = (a: string, b: number): string => (a + b)
      expect(
        EnforceArgumentSchema(schema, func)('abc', 123)
      ).to.be.equal('abc123')
    })
    it('throws error if invalid schema', () => {
      const schema = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }]
      }
      const func = (a: string, b: string): string => (a + b)
      expect(() => {
        EnforceArgumentSchema(schema, func)('abc', '123')
      }).to.be.throw()
    })
  })
  describe('EnforceMethodArgSchema', () => {
    class Test {
      mynumber = 0
      @EnforceMethodArgSchema({
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }]
      })
      test1(a: string, b: number): string {
        return a + b
      }
      @EnforceMethodArgSchema({
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }]
      })
      test2(a: string, b: string): string {
        return a + b
      }
      @EnforceMethodArgSchema({})
      test3(): number {
        return this.mynumber
      }
    }
    it('passes to function w/o error', () => {
      expect(new Test().test1('abc', 123)).to.be.equal('abc123')
    })
    it('applies correct value of `this`', () => {
      const test = new Test()
      test.mynumber = 1234
      new Test().mynumber = 5678
      Object.assign(Test, { mynumber: 4321 })
      expect(test.test3()).to.be.equal(1234)
    })
    it('throws error if invalid schema', () => {
      expect(() => new Test().test2('abc', '123')).to.be.throw()
    })
    it('throws error when applied to non-function', () => {
      expect(() => {
        const myobj = {}
        EnforceMethodArgSchema({})(
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
      }).to.throw('Cannot validate schema for non-function')
    })
  })
})