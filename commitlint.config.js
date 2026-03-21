import { utils } from '@commitlint/config-nx-scopes';

export default {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],
  rules: {
    'scope-enum': async (ctx) => [
      2,
      'always',
      [...(await utils.getProjects(ctx)), 'repo', 'release', 'ci'],
    ],
    'scope-empty': [2, 'never'],
  },
};
