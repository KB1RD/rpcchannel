// eslint-disable-next-line
function isDefined(val: any): boolean {
  return typeof val !== 'undefined' && val !== undefined && val !== null
}
// eslint-disable-next-line
function isUndef(val: any): boolean {
  return !isDefined(val)
}

export { isDefined, isUndef }
