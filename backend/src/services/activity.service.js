import mongoose from 'mongoose';
import Activity from '../models/Activity.model.js';
import Repository from '../models/Repository.model.js';
import User from '../models/User.model.js';
import AppError from '../utils/AppError.js';
import paginate from '../utils/paginate.js';

const safeActivityQuery = (query) =>
  query
    .populate('actor', 'username avatarUrl')
    .populate('repository', 'name');

const buildActivityPage = async (filter, page, limit) => {
  const pagination = paginate(page, limit);
  const [activities, totalItems] = await Promise.all([
    safeActivityQuery(
      Activity.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit)
    ).lean(),
    Activity.countDocuments(filter),
  ]);

  return {
    activities,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.max(1, Math.ceil(totalItems / pagination.limit)),
      totalItems,
    },
  };
};

export const logActivity = async (activityPayload) => {
  return Activity.create(activityPayload);
};

export const getGlobalFeed = async ({ page, limit } = {}) => {
  return buildActivityPage({}, page, limit);
};

export const getUserFeed = async ({ username, page, limit } = {}) => {
  if (!username) {
    throw new AppError('Username parameter is required', 400);
  }

  const user = await User.findOne({ username: username.toLowerCase() });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return buildActivityPage({ actor: user._id }, page, limit);
};

export const getRepositoryFeed = async ({ repo, page, limit } = {}) => {
  if (!repo) {
    throw new AppError('Repository parameter is required', 400);
  }

  const repository = mongoose.Types.ObjectId.isValid(repo)
    ? await Repository.findById(repo)
    : await Repository.findOne({ name: repo });

  if (!repository) {
    throw new AppError('Repository not found', 404);
  }

  return buildActivityPage({ repository: repository._id }, page, limit);
};
