import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import User from '../models/User.model.js';
import PullRequest from '../models/PullRequest.model.js';
import Repository from '../models/Repository.model.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Not authorized to access this route', 401));
  }

  try {
    if (!process.env.JWT_SECRET) {
      return next(new AppError('Server misconfiguration: JWT_SECRET missing', 500));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return next(new AppError('User associated with token no longer exists', 401));
    }

    req.user = user;
    next();
  } catch (error) {
    return next(new AppError('Not authorized to access this route', 401));
  }
});

/**
 * Resource-level authorization guard for pull request write operations.
 *
 * role options:
 *   'author'     — PR author OR repo owner may proceed (update, close)
 *   'repoOwner'  — only the repo owner may proceed (merge)
 *   'readMember' — any authenticated user on public repos; author or repo
 *                  owner only on private repos (comment, review)
 *
 * Attaches req.pullRequest and req.prRepository so downstream handlers
 * skip a redundant DB round-trip.
 */
export const requirePullRequestAccess = (role) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const baseQuery = mongoose.Types.ObjectId.isValid(id)
      ? PullRequest.findById(id)
      : PullRequest.findOne({ number: Number(id) });

    const pullRequest = await baseQuery
      .populate('author', '_id username')
      .populate('repository', '_id name owner visibility');

    if (!pullRequest) {
      return next(new AppError('Pull request not found', 404));
    }

    const repository = await Repository.findById(pullRequest.repository._id).select('owner visibility');
    if (!repository) {
      return next(new AppError('Repository not found', 404));
    }

    const userId = req.user._id.toString();
    const authorId = pullRequest.author._id.toString();
    const ownerId = repository.owner.toString();

    const isAuthor = userId === authorId;
    const isOwner = userId === ownerId;

    if (role === 'repoOwner' && !isOwner) {
      return next(new AppError('Not authorized to perform this action', 403));
    }

    if (role === 'author' && !isAuthor && !isOwner) {
      return next(new AppError('Not authorized to perform this action', 403));
    }

    if (role === 'readMember' && repository.visibility === 'private' && !isAuthor && !isOwner) {
      return next(new AppError('Not authorized to perform this action', 403));
    }

    req.pullRequest = pullRequest;
    req.prRepository = repository;
    next();
  });
