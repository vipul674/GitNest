import User from '../models/User.model.js';
import Repository from '../models/Repository.model.js';
import PullRequest from '../models/PullRequest.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import { sendPaginated } from '../utils/responseHandlers.js';
import paginate, { buildPaginationMeta } from '../utils/paginate.js';

const SEARCH_TYPES = {
  USERS: 'users',
  REPOSITORIES: 'repositories',
  PULL_REQUESTS: 'pullRequests',
  ALL: 'all',
};

const performSearch = async (query, type, skip, limit) => {
  const searchFilter = { $text: { $search: query } };
  const projections = {
    users: { username: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 1, createdAt: 1 },
    repositories: { name: 1, owner: 1, description: 1, language: 1, stars: 1, topics: 1, visibility: 1, _id: 1, createdAt: 1 },
    pullRequests: { title: 1, description: 1, status: 1, author: 1, repository: 1, number: 1, _id: 1, createdAt: 1 },
  };

  const queries = [];

  if (type === SEARCH_TYPES.ALL || type === SEARCH_TYPES.USERS) {
    queries.push(
      Promise.all([
        User.find(searchFilter)
          .select(projections.users)
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(searchFilter)
      ]).then(([docs, count]) => ({
        type: SEARCH_TYPES.USERS,
        items: docs,
        count
      }))
    );
  }

  if (type === SEARCH_TYPES.ALL || type === SEARCH_TYPES.REPOSITORIES) {
    queries.push(
      Promise.all([
        Repository.find(searchFilter)
          .select(projections.repositories)
          .populate('owner', 'username avatarUrl')
          .skip(skip)
          .limit(limit)
          .lean(),
        Repository.countDocuments(searchFilter)
      ]).then(([docs, count]) => ({
        type: SEARCH_TYPES.REPOSITORIES,
        items: docs,
        count
      }))
    );
  }

  if (type === SEARCH_TYPES.ALL || type === SEARCH_TYPES.PULL_REQUESTS) {
    queries.push(
      Promise.all([
        PullRequest.find(searchFilter)
          .select(projections.pullRequests)
          .populate('author', 'username avatarUrl')
          .populate('repository', 'name owner')
          .skip(skip)
          .limit(limit)
          .lean(),
        PullRequest.countDocuments(searchFilter)
      ]).then(([docs, count]) => ({
        type: SEARCH_TYPES.PULL_REQUESTS,
        items: docs,
        count
      }))
    );
  }

  const results = await Promise.all(queries);
  return results;
};

export const globalSearch = asyncHandler(async (req, res, next) => {
  const { q, type = SEARCH_TYPES.ALL, page, limit } = req.query;

  if (!q || q.trim().length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const validTypes = Object.values(SEARCH_TYPES);
  if (!validTypes.includes(type)) {
    return next(new AppError(`Invalid type. Must be one of: ${validTypes.join(', ')}`, 400));
  }

  const { page: pageNum, limit: limitNum, skip } = paginate(page, limit);

  try {
    const searchResults = await performSearch(q.trim(), type, skip, limitNum);

    const formattedResults = {};
    let totalCount = 0;

    searchResults.forEach(result => {
      formattedResults[result.type] = result.items;
      totalCount += result.count;
    });

    const paginationMeta = buildPaginationMeta(pageNum, limitNum, totalCount);

    sendPaginated(
      res,
      200,
      {
        query: q.trim(),
        type,
        results: formattedResults,
      },
      paginationMeta,
      'Search completed successfully'
    );
  } catch (error) {
    if (error.message.includes('text index required')) {
      return next(new AppError('Search functionality is not available', 503));
    }
    throw error;
  }
});
