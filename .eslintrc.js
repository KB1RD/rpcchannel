module.exports = {
  root: true,

  parser: '@typescript-eslint/parser',
  parserOptions: {
    parser: 'babel-eslint',
    ecmaVersion: 2018,
    sourceType: 'module'
  },

  env: {
    browser: true,
    node: true
  },

  extends: [
    'prettier',
    'plugin:prettier/recommended',
    "plugin:@typescript-eslint/eslint-recommended",
    'plugin:@typescript-eslint/recommended'
  ],

  plugins: [
    '@typescript-eslint'
  ],

  rules: {
    camelcase: 'off',
    '@typescript-eslint/camelcase': 'off',
    // ES2015 modules should always be used, but namespaces are used throughout
    // the code to make syntax better (for example, to create a child class)
    '@typescript-eslint/no-namespace': 'off',
    // Conflicts with prettier settings
    '@typescript-eslint/member-delimiter-style': 'off',
    '@typescript-eslint/no-extra-semi': 'off'
  }
}
