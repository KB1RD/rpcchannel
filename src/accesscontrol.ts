import { MultistringAddress, AddressMap } from './addrmap'
import { SerializableData } from './serializer'
import { isDefined } from './utils'

export type AccessPolicy = boolean
export const AccessPolicy = {
  ALLOW: true,
  DENY: false
}
type OptAccessPolicy = AccessPolicy | undefined
export const OptAccessPolicy = Object.assign({ NONE: null }, AccessPolicy)

export type AccessCanFunction = (
  addr: MultistringAddress,
  data: SerializableData[]
) => OptAccessPolicy

/**
 * Controls access to RPC endpoints based on address AND arguments.
 */
export interface AccessController {
  can(addr: MultistringAddress, data: SerializableData[]): OptAccessPolicy
}
/**
 * Always allows access.
 */
export class AllowAccessController implements AccessController {
  can(): AccessPolicy {
    return AccessPolicy.ALLOW
  }
}
/**
 * Always denies access.
 */
export class DenyAccessController implements AccessController {
  can(): AccessPolicy {
    return AccessPolicy.DENY
  }
}
/**
 * Controls access based on a single function
 */
export class FunctionAccessController implements AccessController {
  constructor(public readonly can: AccessCanFunction) {}
}
/**
 * Gives higher `AccessController`s in the chain priority.
 */
export class ChainedAccessController implements AccessController {
  public readonly access_chain: AccessController[] = []
  constructor(public default_ap: AccessPolicy) {}
  can(addr: MultistringAddress, data: SerializableData[]): AccessPolicy {
    let val: OptAccessPolicy
    this.access_chain.some((ctrl) => isDefined((val = ctrl.can(addr, data))))
    return (isDefined(val) ? val : this.default_ap) as AccessPolicy
  }
}
/**
 * The old type of access control based on an address-to-policy map.
 */
export class LegacyAccessController implements AccessController {
  public readonly map = new AddressMap<AccessPolicy>()
  can(to: MultistringAddress): OptAccessPolicy {
    return this.map.get(to)
  }
}
/**
 * Lookup a function to determine access on a per-address basis
 */
export class FunctionLookupAccessController implements AccessController {
  public readonly map = new AddressMap<AccessCanFunction>()
  can(to: MultistringAddress, data: SerializableData[]): OptAccessPolicy {
    const func = this.map.get(to)
    return func && func(to, data)
  }
}
