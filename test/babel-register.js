/**
 * See https://github.com/mochajs/mocha-examples/tree/2c325c4aab27773abd7563b17d4d18a495381e3e/packages/typescript-babel#testing-ts--babel-with-mocha
 */

const register = require('@babel/register').default;

register({ extensions: ['.ts', '.tsx', '.js', '.jsx'] });