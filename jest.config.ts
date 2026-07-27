export default {
  roots: ['./src'],
  // The component-test harness (src/test/*, *.test.tsx) is upstream's VITEST
  // setup and has never run in this fork: @testing-library/react,
  // @testing-library/user-event and a jsdom environment are not declared in
  // package.json at all, and src/test/setup.ts imports vitest directly. Jest
  // picks the files up via testMatch and fails to resolve, which is the only
  // reason `pnpm test` was red while every actual test passed.
  //
  // Excluded rather than deleted: enabling it is a real decision (add
  // @testing-library/react + @testing-library/user-event +
  // jest-environment-jsdom, set testEnvironment: 'jsdom', and port
  // src/test/setup.ts off vitest). Nothing is lost today — these suites have
  // never executed here.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/test/', '\\.test\\.tsx$'],

  testMatch: ['**/__tests__/**/*.+(ts|tsx|js)', '**/?(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
