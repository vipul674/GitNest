import fs from 'fs';

import Repository from '../models/Repository.model.js';

import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';

import {
  generateRepositoryArchive,
} from '../services/archive.service.js';

export const downloadRepositoryArchive =
  asyncHandler(
    async (req, res, next) => {
      const { repoName } = req.params;

      const repository =
        await Repository.findOne({
          owner: req.user.id,
          name: repoName,
        });

      if (!repository) {
        return next(
          new AppError(
            'Repository not found',
            404
          )
        );
      }

      const zipPath =
        await generateRepositoryArchive(
          req.user.id,
          repoName
        );

      res.download(
        zipPath,
        `${repoName}.zip`,
        () => {
          if (
            fs.existsSync(zipPath)
          ) {
            fs.unlinkSync(zipPath);
          }
        }
      );
    }
  );
