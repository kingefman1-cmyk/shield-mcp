module.exports = {
  preset: '@metamask/snaps-jest',
  transform: {
    '^.+\\.(t|j)sx?$':'<rootDir>/test/support/esm-transformer.js',
  },
  // Dependencies are passed through the transformer too; it only compiles packages that ship ES modules only.
  transformIgnorePatterns: [],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  testTimeout: 60000,
};
