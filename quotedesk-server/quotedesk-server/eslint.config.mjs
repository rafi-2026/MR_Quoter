export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'no-console': 'off'
    }
  }
];
