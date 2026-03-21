import nxScopes from '@commitlint/config-nx-scopes';

export default {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],
  rules: {
    'scope-enum': (ctx) => {
      const nxProjects = nxScopes.utils.getProjects(ctx);

      return [2, 'always', [...nxProjects, 'repo', 'release', 'ci']];
    },
    'scope-empty': [2, 'never'],
  },
};
