import { expect } from 'chai'
import { isDefined, isUndef } from '../src/utils'

describe('[utils.ts] Utils', () => {
  describe('isDefined', () => {
    it('returns false if undefined/null', () => {
      expect(isDefined(undefined)).to.be.false
      expect(isDefined(null)).to.be.false
    })
    it('returns true if false/0/NaN', () => {
      expect(isDefined(false)).to.be.true
      expect(isDefined(0)).to.be.true
      expect(isDefined(NaN)).to.be.true
    })
    it('returns true if obviously defined', () => {
      expect(isDefined(true)).to.be.true
      expect(isDefined(3423423)).to.be.true
      expect(isDefined('hello')).to.be.true
      expect(isDefined({})).to.be.true
    })
  })
  describe('isUndef', () => {
    it('returns true if undefined/null', () => {
      expect(isUndef(undefined)).to.be.true
      expect(isUndef(null)).to.be.true
    })
    it('returns false if false/0/NaN', () => {
      expect(isUndef(false)).to.be.false
      expect(isUndef(0)).to.be.false
      expect(isUndef(NaN)).to.be.false
    })
    it('returns false if obviously defined', () => {
      expect(isUndef(true)).to.be.false
      expect(isUndef(3423423)).to.be.false
      expect(isUndef('hello')).to.be.false
      expect(isUndef({})).to.be.false
    })
  })
})