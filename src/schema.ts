import Ajv from 'ajv'

type Schema = Record<string, unknown> | boolean

const ajv = new Ajv()

// eslint-disable-next-line
function EnforceArgumentSchema<F extends (...args: any[]) => void>(
  schema: Schema,
  func: F
): F {
  const ValidateSchema = ajv.compile(schema)
  // I really just have to force this since TS has no way of doing this, AFAIK
  // eslint-disable-next-line
  return (((...args: any[]) => {
    ValidateSchema(args)
    if (ValidateSchema.errors?.length) {
      const error = new Ajv.ValidationError([...ValidateSchema.errors])
      ValidateSchema.errors.length = 0
      throw error
    }
    return func(...args)
  }) as unknown) as F
}

function EnforceMethodArgSchema(schema: Schema) {
  return function (
    // eslint-disable-next-line
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const func = descriptor.value
    if (typeof func !== 'function') {
      throw new TypeError('Cannot validate schema for non-function')
    }
    const ValidateSchema = ajv.compile(schema)
    // eslint-disable-next-line
    descriptor.value = function (...args: any[]) {
      ValidateSchema(args)
      if (ValidateSchema.errors?.length) {
        const error = new Ajv.ValidationError([...ValidateSchema.errors])
        ValidateSchema.errors.length = 0
        throw error
      }
      return func.apply(this, args)
    }
    return descriptor
  }
}

export { EnforceArgumentSchema, EnforceMethodArgSchema }
