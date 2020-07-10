# rpcchannel
> A simple system for doing remote procedure calls (RPCs) in JS/TS.
![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/kb1rd/rpcchannel)
![GitHub Workflow Status (branch)](https://img.shields.io/github/workflow/status/kb1rd/rpcchannel/Yarn%20CI/dev?label=dev%20build%2Ftest)
![GitHub](https://img.shields.io/github/license/kb1rd/rpcchannel)

**Note: This is experimental software ATM and is under active development. Use
with caution. Consider all APIs unstable.**

This assumes that there are only two peers per `RpcChannel`. An `RpcChannel` is
created with a send function that sends to whichever transport is being used.
This could literally just be a wrapper for a `MessagePort`'s `postMessage`
function. Messages are processed by calling the `recieve` function on the
`RpcChannel` object.

Each RPC function has a particular address, which is just an array of multiple
strings. They are determined using the Java package naming convention, like so:
```json
["net", "kb1rd", "mycoolprotocol"]
```

Here's the most basic example: (in Typescript. Just remove the type annotations
for normal JS)
```typescript
const {
  RpcChannel,
  RpcAddress,
  EnforceMethodArgSchema
} = require('@kb1rd/rpcchannel')

// Just pretend these are in different browsing contexts :P
const a: RpcChannel = new RpcChannel((msg) =>
  b.receive(JSON.parse(JSON.stringify(msg)))
)
const b = new RpcChannel((msg) => a.receive(JSON.parse(JSON.stringify(msg))))

b.register(['net', 'kb1rd', 'sayhi'], (): string => {
  console.log('Hi!')
  return 'hi'
})

// Send is unidirectional and does not wait for a response
a.send(['net', 'kb1rd', 'sayhi']) // Prints "Hi!"

async function test() {
  // Prints "Hi!" and waits for the remote function to terminate
  const value = await a.call(['net', 'kb1rd', 'sayhi'])
  console.log(value) // Prints "hi"
}
test()
```

A part of the address can also be `undefined`, which acts as a wildcard, like so:
```typescript
const {
  RpcChannel,
  RpcAddress,
  EnforceMethodArgSchema
} = require('@kb1rd/rpcchannel')

// Just pretend these are in different browsing contexts :P
const a: RpcChannel = new RpcChannel((msg) =>
  b.receive(JSON.parse(JSON.stringify(msg)))
)
const b = new RpcChannel((msg) => a.receive(JSON.parse(JSON.stringify(msg))))

b.register(['net', 'kb1rd', 'say', undefined], (channel, wc) => {
  console.log(wc[0])
})

a.send(['net', 'kb1rd', 'say', 'Hello!']) // Prints "Hello!"
```
Note the arguments of the function. `channel` is the RPC channel that recieved
the call, and `wc` is an array of values for wildcards. Wildcards can be
filtered by permissions, whereas arguments cannot be.

Here's an example of setting permissions to a particular endpoint:
```typescript
const {
  RpcChannel,
  RpcAddress,
  EnforceMethodArgSchema,
  AccessPolicy
} = require('@kb1rd/rpcchannel')

// Just pretend these are in different browsing contexts :P
const a: RpcChannel = new RpcChannel((msg) =>
  b.receive(JSON.parse(JSON.stringify(msg)))
)
const b = new RpcChannel((msg) => a.receive(JSON.parse(JSON.stringify(msg))))

b.register(['net', 'kb1rd', 'say', undefined], (channel, wc) => {
  console.log(wc[0])
})

b.setPolicy(['net', 'kb1rd', 'say', 'badword'], AccessPolicy.DENY)

a.send(['net', 'kb1rd', 'say', 'badword']) // Throws an error
```
Wildcards can also be used with policies. In addition, the default policy can
be set to `DENY` with `b.setPolicy([], AccessPolicy.DENY)`.

Functions can also be given arguments
```typescript
const {
  RpcChannel,
  RpcAddress,
  EnforceArgumentSchema
} = require('@kb1rd/rpcchannel')

// Just pretend these are in different browsing contexts :P
const a: RpcChannel = new RpcChannel((msg) =>
  b.receive(JSON.parse(JSON.stringify(msg)))
)
const b = new RpcChannel((msg) => a.receive(JSON.parse(JSON.stringify(msg))))

b.register(
  ['net', 'kb1rd', 'add'],
  // This enforces a JSON schema on the function's arguments
  EnforceArgumentSchema(
    {
      type: 'array',
      items: [
        { type: 'object' },
        { type: 'array', items: { type: 'string' } },
        { type: 'number' },
        { type: 'number' }
      ]
    },
    // Arguments come after then channel and wildcards
    (channel, wc, a: number, b: number) => (a + b)
  )
)

async function test() {
  // The last array is the arguments to pass to the function
  const value = await a.call(['net', 'kb1rd', 'add'], [1, 2])
  console.log(value) // Prints "3"
}
test()
```

Finally, here's a big example demonstrating `registerAll`:
```typescript
const {
  RpcChannel,
  RpcAddress,
  EnforceMethodArgSchema
} = require('@kb1rd/rpcchannel')

const a: RpcChannel = new RpcChannel((msg) =>
  b.receive(JSON.parse(JSON.stringify(msg)))
)
const b = new RpcChannel((msg) => a.receive(JSON.parse(JSON.stringify(msg))))

class TestClass {
  test = 1234
  // RpcAddress decorator always comes first since `EnforceMethodArgSchema`
  // will overwrite it
  @RpcAddress(['net', 'kb1rd', 'addto'])
  @EnforceMethodArgSchema({
    type: 'array',
    items: [
      { type: 'object' },
      { type: 'array', items: { type: 'string' } },
      { type: 'number' }
    ]
  })
  addto(chan: RpcChannel, wc: string[], n: number): number {
    return (this.test += n)
  }
  @RpcAddress(['net', 'kb1rd', 'greet', undefined])
  @EnforceMethodArgSchema({
    type: 'array',
    items: [{ type: 'object' }, { type: 'array', items: { type: 'string' } }]
  })
  greet(chan: RpcChannel, wc: string[]): string {
    return `Hello, ${wc[0]}`
  }
}

// This registers all members of an object with `@RpcAddress` applied to them
// You can also set the RpcFunctionAddress (imported from `rpcchannel`) on a
// member function to the address you'd like and it will be seen by
// `registerAll` (@RpcAddress literally just does
// `func[RpcFunctionAddress] = address`)
b.registerAll(new TestClass())

async function test() {
  a.send(['net', 'kb1rd', 'sayhi']) // "Hi!"

  let data = await a.call(['net', 'kb1rd', 'addto'], [1])
  console.log(data) // "1235"

  // Access `call_obj` to get an object that will return a function for every
  // string you can access. This is just a prettier way of doing `call`.
  data = await a.call_obj.net.kb1rd.addto(20)
  console.log(data) // "1255"

  try {
    const data = await a.call(['net', 'kb1rd', 'addto'], ['hi'])
    console.log(data)
  } catch (e) {
    console.error('ERROR:', e) // "ERROR: ... validation failed"
  }

  data = await a.call_obj.net.kb1rd.greet['World!']()
  console.log(data) // "Hello, World!"
}
test()
```