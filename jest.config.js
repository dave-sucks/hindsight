/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    // jsx: a test can render a component to HTML (react-dom/server); Next's own build keeps "preserve".
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs", jsx: "react-jsx" } }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/*.test.ts"],
  // Only run unit tests (no DB/Inngest)
  testPathIgnorePatterns: ["/node_modules/"],
};
