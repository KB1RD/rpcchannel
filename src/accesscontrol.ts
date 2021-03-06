import { MultistringAddress, AddressMap } from './addrmap'
import { SerializableData } from './serializer'
import { isDefined } from './utils'
import { RpcChannel, RpcFunction } from './registry'

export type AccessPolicy = boolean
export const AccessPolicy = {
  ALLOW: true,
  DENY: false
}
export type OptAccessPolicy = AccessPolicy | undefined | null
export const OptAccessPolicy = Object.assign({ NONE: null }, AccessPolicy)

export interface CanCallOpts {
  args: SerializableData[]
  wc: string[]
  channel: RpcChannel
  func?: RpcFunction
}

export type AccessCanFunction = (
  addr: MultistringAddress,
  opts: CanCallOpts
) => OptAccessPolicy

/**
 * Controls access to RPC endpoints based on address AND arguments.
 */
export interface AccessController {
  can(addr: MultistringAddress, opts: CanCallOpts): OptAccessPolicy
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
  constructor(public default_ap: OptAccessPolicy = OptAccessPolicy.NONE) {}
  can(addr: MultistringAddress, opts: CanCallOpts): OptAccessPolicy {
    let val: OptAccessPolicy
    this.access_chain.some((ctrl) => isDefined((val = ctrl.can(addr, opts))))
    return isDefined(val) ? val : this.default_ap
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
  can(to: MultistringAddress, opts: CanCallOpts): OptAccessPolicy {
    const func = this.map.get(to)
    return (func && func(to, opts)) || OptAccessPolicy.NONE
  }
}
export const CanCallFunction = Symbol('CanCall')
export const RequiresPermissions = Symbol('RequiresPermissions')
export interface PermissionedCanCallOpts extends CanCallOpts {
  require: (perm: string) => void
  perms: Set<string>
}
export type PermissionedAccessCanFunction = (
  addr: MultistringAddress,
  opts: PermissionedCanCallOpts
) => OptAccessPolicy
/**
 * First, this `AccessController` will check the `RequiresPermissions` property
 * on the target function. If any of these are missing from the member `perms`
 * set, then access is denied. Otherwise, if `CanCallFunction` is defined, then
 * its result is returned. The `CanCallFunction` may also require permissions.
 */
export class AutoFunctionAccessController implements AccessController {
  constructor(public perms = new Set<string>()) {}
  can(to: MultistringAddress, opts: CanCallOpts): OptAccessPolicy {
    const obj = opts.func && opts.func[RequiresPermissions]
    if (typeof obj === 'object' && typeof obj[Symbol.iterator] === 'function') {
      for (const requirement of obj) {
        if (!this.perms.has(requirement)) {
          return AccessPolicy.DENY
        }
      }
    }
    const func = opts.func && opts.func[CanCallFunction]
    if (typeof func === 'function') {
      const requirements = new Set<string>()
      const result = func(
        to,
        Object.assign(
          { require: (s: string) => requirements.add(s), perms: this.perms },
          opts
        )
      )
      for (const requirement of requirements) {
        if (!this.perms.has(requirement)) {
          return AccessPolicy.DENY
        }
      }
      return isDefined(result) ? Boolean(result) : OptAccessPolicy.NONE
    }
    return OptAccessPolicy.NONE
  }
}

export function RequirePermissions(perms: string[]) {
  return function (
    // eslint-disable-next-line
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): void {
    const func = descriptor.value
    if (typeof func !== 'function') {
      throw new TypeError('Cannot require permissions for non-function')
    }
    func[RequiresPermissions] = perms
  }
}
export function SetCanCallFunc(can: AccessCanFunction) {
  return function (
    // eslint-disable-next-line
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): void {
    const func = descriptor.value
    if (typeof func !== 'function') {
      throw new TypeError('Cannot set access controller func on non-function')
    }
    func[CanCallFunction] = can
  }
}
