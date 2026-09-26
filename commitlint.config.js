// Conventional Commits. See https://www.conventionalcommits.org
// Examples:
//   feat(web): add athlete admin table
//   fix(server): prune stale connections on 410
//   test(web): cover DNF sentinel formatting
//   chore(ci): add coverage upload
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['web', 'server', 'ci', 'deps', 'docs', 'repo']],
    'body-max-line-length': [0, 'always'],
  },
};
