import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

export default [
  { ignores: ['src/generated/**', '.next/**', 'node_modules/**'] },
  ...coreWebVitals,
  ...typescript,
];
