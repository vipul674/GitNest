import swaggerJSDoc from 'swagger-jsdoc';
import { components, contracts } from '../contracts/index.js';

const json = (schema) => ({ content: { 'application/json': { schema } } });
const errors = {
  400: { description: 'Validation error', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
  401: { description: 'Authentication error', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
  403: { description: 'Forbidden', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
  404: { description: 'Not found', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
  422: { description: 'Unprocessable entity', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
  500: { description: 'Server error', ...json({ $ref: '#/components/schemas/ErrorEnvelope' }) },
};

const params = (schema = {}) => [
  ...Object.keys(schema.properties || {}).map((name) => ({
    name,
    in: 'path',
    required: (schema.required || []).includes(name),
    schema: schema.properties[name],
  })),
];

const query = (schema = {}) =>
  Object.keys(schema.properties || {}).map((name) => ({
    name,
    in: 'query',
    required: (schema.required || []).includes(name),
    schema: schema.properties[name],
  }));

const op = (contract) => ({
  tags: contract.tags,
  summary: contract.summary,
  security: contract.security,
  parameters: [...params(contract.request?.params), ...query(contract.request?.query)],
  requestBody: contract.request?.body ? { required: true, ...json(contract.request.body) } : undefined,
  responses: {
    ...Object.fromEntries(
      Object.entries(contract.responses || {}).map(([status, schema]) => [
        status,
        { description: `${status} response`, ...json(schema) },
      ])
    ),
    ...errors,
  },
});

const paths = {
  '/api/v1/auth/register': { post: op(contracts.auth.register) },
  '/api/v1/auth/login': { post: op(contracts.auth.login) },
  '/api/v1/auth/me': { get: op(contracts.auth.me) },
  '/api/v1/users/{username}': { get: op(contracts.users.profile) },
  '/api/v1/users/profile': { put: op(contracts.users.updateProfile) },
  '/api/v1/users/{username}/follow': { post: op(contracts.users.follow), delete: op(contracts.users.unfollow) },
  '/api/v1/users/{username}/followers': { get: op(contracts.users.followers) },
  '/api/v1/users/{username}/following': { get: op(contracts.users.following) },
  '/api/v1/repositories': { post: op(contracts.repositories.create) },
  '/api/v1/repositories/{username}': { get: op(contracts.repositories.listByUser) },
  '/api/v1/repositories/{username}/{reponame}': { get: op(contracts.repositories.get), put: op(contracts.repositories.update), delete: op(contracts.repositories.remove) },
  '/api/v1/repositories/{username}/{reponame}/star': { post: op(contracts.repositories.star) },
  '/api/v1/repositories/{username}/{reponame}/fork': { post: op(contracts.repositories.fork) },
  '/api/v1/repos/{username}/{reponame}/settings/branch-protection': {
    get: op(contracts.branchProtection.list),
    post: op(contracts.branchProtection.create),
  },
  '/api/v1/repos/{username}/{reponame}/settings/branch-protection/{ruleId}': {
    put: op(contracts.branchProtection.update),
    delete: op(contracts.branchProtection.remove),
  },
  '/api/v1/activities/global': { get: op(contracts.activities.global) },
  '/api/v1/activities/user/{username}': { get: op(contracts.activities.user) },
  '/api/v1/activities/repository/{repo}': { get: op(contracts.activities.repository) },
  '/api/v1/pull-requests': { get: op(contracts.pullRequests.list), post: op(contracts.pullRequests.create) },
  '/api/v1/pull-requests/{id}': { get: op(contracts.pullRequests.detail), put: op(contracts.pullRequests.update) },
  '/api/v1/pull-requests/{id}/merge': { post: op(contracts.pullRequests.merge) },
  '/api/v1/pull-requests/{id}/close': { post: op(contracts.pullRequests.close) },
  '/api/v1/pull-requests/{id}/comments': { post: op(contracts.pullRequests.comment) },
  '/api/v1/pull-requests/{id}/reviews': { post: op(contracts.pullRequests.review) },
  '/api/v1/repositories/{username}/{reponame}/index': { post: op(contracts.codeIntelligence.triggerIndex) },
  '/api/v1/repositories/{username}/{reponame}/index/status/{indexId}': { get: op(contracts.codeIntelligence.indexStatus) },
  '/api/v1/repositories/{username}/{reponame}/symbols/search': { get: op(contracts.codeIntelligence.searchSymbols) },
  '/api/v1/repositories/{username}/{reponame}/symbols/{symbolId}': { get: op(contracts.codeIntelligence.symbolDetails) },
  '/api/v1/repositories/{username}/{reponame}/dependencies/rebuild': { post: op(contracts.codeIntelligence.rebuildDependencies) },
  '/api/v1/repositories/{username}/{reponame}/dependencies': { get: op(contracts.codeIntelligence.listDependencies) },
  '/api/v1/repositories/{username}/{reponame}/dependencies/impact': { get: op(contracts.codeIntelligence.dependencyImpact) },
  '/api/v1/repositories/{username}/{reponame}/dependencies/symbol/{symbolName}': { get: op(contracts.codeIntelligence.symbolDependencies) },
  '/api/v1/repositories/{username}/{reponame}/architecture': { get: op(contracts.architecture.get) },
  '/api/v1/repositories/{username}/{reponame}/architecture/hotspots': { get: op(contracts.architecture.hotspots) },
  '/api/v1/repositories/{username}/{reponame}/architecture/risk': { get: op(contracts.architecture.risk) },
  '/api/v1/repositories/{username}/{reponame}/architecture/module/{moduleName}': { get: op(contracts.architecture.module) },
  '/api/v1/repositories/{username}/{reponame}/health': { get: op(contracts.repositoryHealth.get) },
  '/api/v1/repositories/{username}/{reponame}/health/history': { get: op(contracts.repositoryHealth.history) },
  '/api/v1/repositories/{username}/{reponame}/health/breakdown': { get: op(contracts.repositoryHealth.breakdown) },
  '/api/v1/repositories/{username}/{reponame}/health/recommendations': {
    get: op(contracts.repositoryHealth.recommendations),
  },
  '/api/v1/repositories/{username}/{reponame}/compliance': { get: op(contracts.repositoryCompliance.get) },
  '/api/v1/repositories/{username}/{reponame}/compliance/history': {
    get: op(contracts.repositoryCompliance.history),
  },
  '/api/v1/repositories/{username}/{reponame}/compliance/violations': {
    get: op(contracts.repositoryCompliance.violations),
  },
  '/api/v1/repositories/{username}/{reponame}/compliance/report': {
    get: op(contracts.repositoryCompliance.report),
  },
};

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'GitNest API',
    version: process.env.API_VERSION || '1.0.0',
    description: 'Schema-driven API contract for GitNest MERN services.',
  },
  servers: [{ url: process.env.API_PUBLIC_URL || 'http://localhost:5000' }],
  tags: ['Auth', 'Users', 'Repositories', 'Activities', 'Pull Requests', 'Code Intelligence', 'Architecture', 'Repository Health', 'Repository Compliance'].map((name) => ({ name })),
  components,
  paths,
};

const swaggerSpec = { ...swaggerJSDoc({ definition, apis: [] }), paths, components };

export { swaggerSpec };
export default swaggerSpec;
