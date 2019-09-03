module.exports = {
  norpc: true,
  compileCommand: '../node_modules/.bin/truffle compile',
  copyPackages: [
    '@aragon/os',
    '@aragon/test-helpers'
  ],
  skipFiles: [
    'test',
    '@aragon/os',
    '@aragon/test-helpers',
  ],
  deepSkip: true // Turn on deep skip to avoid preprocessing (e.g. removing view/pure modifiers) for skipped files
}
