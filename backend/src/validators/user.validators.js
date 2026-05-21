import { body } from 'express-validator';

export const updateProfileValidator = [
  body('bio')
    .optional()
    .trim()
    .isString().withMessage('Bio must be a string')
    .isLength({ max: 200 }).withMessage('Bio must be at most 200 characters'),

  body('location')
    .optional()
    .trim()
    .isString().withMessage('Location must be a string')
    .isLength({ max: 100 }).withMessage('Location must be at most 100 characters'),

  body('website')
    .optional()
    .trim()
    .custom((val) => {
      if (val === '') return true;
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    })
    .withMessage('Website must be a valid http or https URL'),

  body('avatarUrl')
    .optional()
    .trim()
    .custom((val) => {
      if (val === '') return true;
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    })
    .withMessage('Avatar URL must be a valid http or https URL'),
];
