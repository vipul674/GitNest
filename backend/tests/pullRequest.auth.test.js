import { jest, describe, beforeEach, test, expect } from '@jest/globals';

process.env.JWT_SECRET = 'test_jwt_secret_pr_auth';
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Shared test IDs (24-char hex strings → valid ObjectIds)
// ---------------------------------------------------------------------------
const REPO_OWNER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PR_AUTHOR_ID  = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const STRANGER_ID   = 'cccccccccccccccccccccccc';
const PR_ID         = 'dddddddddddddddddddddddd';
const REPO_ID       = 'eeeeeeeeeeeeeeeeeeeeeeee';

// ---------------------------------------------------------------------------
// Model mocks — declared before dynamic imports so jest hoists them
// ---------------------------------------------------------------------------
const mockPRFindById   = jest.fn();
const mockPRFindOne    = jest.fn();
const mockRepoFindById = jest.fn();

jest.unstable_mockModule('../src/models/PullRequest.model.js', () => ({
  default: {
    findById: mockPRFindById,
    findOne:  mockPRFindOne,
  },
}));

jest.unstable_mockModule('../src/models/Repository.model.js', () => ({
  default: {
    findById: mockRepoFindById,
    findOne: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/models/User.model.js', () => ({
  default: { findById: jest.fn(), findOne: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeReq = (userId, paramId = PR_ID) => ({
  params: { id: paramId },
  user:   { _id: { toString: () => userId } },
});

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

/**
 * Runs an Express middleware and returns a promise that resolves once `next`
 * is invoked — either with no arguments (success) or with an error argument.
 * Returns { req, nextArg } where nextArg is undefined on success or the
 * AppError instance passed to next() on failure.
 */
const runMiddleware = (middleware, req) => {
  const res = makeRes();
  return new Promise((resolve) => {
    middleware(req, res, (errOrNothing) => resolve({ req, nextArg: errOrNothing }));
  });
};

const populateChain = (result) => {
  const chain = { populate: jest.fn(() => chain) };
  chain.then  = (ok) => Promise.resolve(result).then(ok);
  chain.catch = (err) => Promise.resolve(result).catch(err);
  return chain;
};

const makePR = (authorId = PR_AUTHOR_ID) => ({
  _id: { toString: () => PR_ID },
  number: 1,
  status: 'open',
  title: 'Test PR',
  author: { _id: { toString: () => authorId } },
  repository: {
    _id:        { toString: () => REPO_ID },
    name:       'repo',
    owner:      REPO_OWNER_ID,
    visibility: 'public',
  },
  comments:  [],
  reviews:   [],
  save: jest.fn().mockResolvedValue(true),
  populate: jest.fn().mockReturnThis(),
  toObject: jest.fn(function () { return { ...this, _id: PR_ID }; }),
});

const makeRepo = (visibility = 'public') => ({
  _id:        { toString: () => REPO_ID },
  owner:      REPO_OWNER_ID,
  visibility,
});

// ---------------------------------------------------------------------------
// Import the middleware under test after mocks are registered
// ---------------------------------------------------------------------------
let requirePullRequestAccess;

beforeAll(async () => {
  const mod = await import('../src/middleware/authMiddleware.js');
  requirePullRequestAccess = mod.requirePullRequestAccess;
});

// ---------------------------------------------------------------------------
// Default mock wiring
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockPRFindById.mockReturnValue(populateChain(makePR()));
  mockRepoFindById.mockReturnValue({ select: jest.fn().mockResolvedValue(makeRepo()) });
});

// ---------------------------------------------------------------------------
// role='author' (updatePullRequest, closePullRequest)
// ---------------------------------------------------------------------------
describe("requirePullRequestAccess('author')", () => {
  const run = (userId, id = PR_ID) =>
    runMiddleware(requirePullRequestAccess('author'), makeReq(userId, id));

  test('repo owner is allowed through', async () => {
    const { nextArg } = await run(REPO_OWNER_ID);
    expect(nextArg).toBeUndefined();
  });

  test('PR author is allowed through', async () => {
    const { nextArg } = await run(PR_AUTHOR_ID);
    expect(nextArg).toBeUndefined();
  });

  test('stranger receives AppError 403', async () => {
    const { nextArg } = await run(STRANGER_ID);
    expect(nextArg).toBeDefined();
    expect(nextArg.statusCode).toBe(403);
    expect(nextArg.message).toMatch(/not authorized/i);
  });

  test('attaches pullRequest and prRepository to req on success', async () => {
    const { req } = await run(REPO_OWNER_ID);
    expect(req.pullRequest).toBeDefined();
    expect(req.prRepository).toBeDefined();
  });

  test('returns 404 AppError when PR does not exist', async () => {
    mockPRFindById.mockReturnValue(populateChain(null));
    const { nextArg } = await run(REPO_OWNER_ID);
    expect(nextArg.statusCode).toBe(404);
  });

  test('returns 404 AppError when repository does not exist', async () => {
    mockRepoFindById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const { nextArg } = await run(REPO_OWNER_ID);
    expect(nextArg.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// role='repoOwner' (mergePullRequest)
// ---------------------------------------------------------------------------
describe("requirePullRequestAccess('repoOwner')", () => {
  const run = (userId) =>
    runMiddleware(requirePullRequestAccess('repoOwner'), makeReq(userId));

  test('repo owner is allowed through', async () => {
    const { nextArg } = await run(REPO_OWNER_ID);
    expect(nextArg).toBeUndefined();
  });

  test('PR author (non-owner) receives 403', async () => {
    const { nextArg } = await run(PR_AUTHOR_ID);
    expect(nextArg.statusCode).toBe(403);
    expect(nextArg.message).toMatch(/not authorized/i);
  });

  test('stranger receives 403', async () => {
    const { nextArg } = await run(STRANGER_ID);
    expect(nextArg.statusCode).toBe(403);
  });

  test('attaches pullRequest and prRepository to req for repo owner', async () => {
    const { req } = await run(REPO_OWNER_ID);
    expect(req.pullRequest).toBeDefined();
    expect(req.prRepository).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// role='readMember' (addPullRequestComment, submitPullRequestReview)
// ---------------------------------------------------------------------------
describe("requirePullRequestAccess('readMember')", () => {
  const run = (userId, repoVisibility = 'public') => {
    mockRepoFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue(makeRepo(repoVisibility)),
    });
    return runMiddleware(requirePullRequestAccess('readMember'), makeReq(userId));
  };

  test('any user passes for a public-repo PR', async () => {
    const { nextArg } = await run(STRANGER_ID, 'public');
    expect(nextArg).toBeUndefined();
  });

  test('repo owner passes for a private-repo PR', async () => {
    const { nextArg } = await run(REPO_OWNER_ID, 'private');
    expect(nextArg).toBeUndefined();
  });

  test('PR author passes for a private-repo PR', async () => {
    const { nextArg } = await run(PR_AUTHOR_ID, 'private');
    expect(nextArg).toBeUndefined();
  });

  test('stranger receives 403 for a private-repo PR', async () => {
    const { nextArg } = await run(STRANGER_ID, 'private');
    expect(nextArg.statusCode).toBe(403);
    expect(nextArg.message).toMatch(/not authorized/i);
  });
});

// ---------------------------------------------------------------------------
// ID resolution — numeric PR number (findOne path)
// ---------------------------------------------------------------------------
describe('PR lookup by numeric id', () => {
  test('resolves by number when id is not a valid ObjectId', async () => {
    mockPRFindOne.mockReturnValue(populateChain(makePR()));
    const req = { params: { id: '42' }, user: { _id: { toString: () => REPO_OWNER_ID } } };
    const { nextArg } = await runMiddleware(requirePullRequestAccess('author'), req);
    expect(mockPRFindOne).toHaveBeenCalledWith({ number: 42 });
    expect(nextArg).toBeUndefined();
  });
});
