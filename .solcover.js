const skipFiles = [
  'lib',
  'test',
  'standards'
]

const providerOptions = {
  "total_accounts": 200
}

module.exports = {
  skipFiles,
  providerOptions,
  mocha: {
    grep: "@skip-on-coverage", // Find everything with this tag
    invert: true               // Run the grep's inverse set.
  }
}
