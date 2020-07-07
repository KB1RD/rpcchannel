/**
 * A mapping of multi-part addresses (using the Java naming convention) to any
 * type. Used extensively by the RPC channel.
 * @author Nathan Pennie <kb1rd@kb1rd.net>
 */
/** */

import { isUndef } from './utils'

type MultistringAddress = string[]
type WildcardMultistringAddress = (string | undefined | null)[]

const DefaultEntryKey = Symbol('DefaultEntry')
const WildcardEntryKey = Symbol('WildcardEntry')

type AddressMapFlat<T> = {
  [key: string]: AddressMapFlat<T>
  [WildcardEntryKey]?: AddressMapFlat<T>
  [DefaultEntryKey]?: T
}

function getFromAddrMapFlat<T>(
  map: AddressMapFlat<T>,
  addr: MultistringAddress,
  wc_values?: string[]
): T | undefined {
  const part = addr.shift()

  if (!part) {
    return map[DefaultEntryKey]
  }

  let data: T | undefined = undefined
  if (map[part]) {
    data = getFromAddrMapFlat(map[part], addr, wc_values)
  }
  if (!data && map[WildcardEntryKey]) {
    if (wc_values) {
      wc_values.push(part)
    }
    data = getFromAddrMapFlat(
      map[WildcardEntryKey] as AddressMapFlat<T>,
      addr,
      wc_values
    )
  }

  addr.unshift(part)
  return data
}

class AddressMap<T> {
  table: AddressMapFlat<T> = {}
  put(addr: WildcardMultistringAddress, value: T | undefined): void {
    let last_table = this.table
    addr.forEach((part) => {
      const key = part || WildcardEntryKey
      if (isUndef(last_table[key])) {
        last_table[key] = {}
      }
      last_table = last_table[key] as AddressMapFlat<T>
    })
    // TODO: Delete parents if empty
    if (isUndef(value)) {
      delete last_table[DefaultEntryKey]
    } else {
      last_table[DefaultEntryKey] = value
    }
  }

  get(addr: MultistringAddress, wc_values?: string[]): T | undefined {
    return (
      getFromAddrMapFlat(this.table, addr, wc_values) ||
      this.table[DefaultEntryKey]
    )
  }

  toString(): string {
    const entries: string[] = []
    const addr_str: string[] = []
    function traverse(map: AddressMapFlat<T>) {
      if (map[DefaultEntryKey]) {
        entries.push(`${addr_str.join('.')}: ${map[DefaultEntryKey]}`)
      }
      if (map[WildcardEntryKey]) {
        addr_str.push('*')
        traverse(map[WildcardEntryKey] as AddressMapFlat<T>)
        addr_str.pop()
      }
      Object.keys(map).forEach((key) => {
        if (map[key]) {
          addr_str.push(`[${key}]`)
          traverse(map[key])
          addr_str.pop()
        }
      })
    }
    traverse(this.table)
    return `AddrMap [\n${entries.map((s) => '  ' + s).join('\n')}\n]`
  }
}

export { MultistringAddress, WildcardMultistringAddress, AddressMap }
