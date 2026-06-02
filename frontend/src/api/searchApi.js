import { createApiClient } from './createApiClient.js';
import { API_BASE_URL } from '../utils/apiConfig.js';

const searchApi = createApiClient(`${API_BASE_URL}/search`);

export const performGlobalSearch = async ({ query, type = 'all', page = 1, limit = 20 } = {}) => {
  if (!query || query.trim().length < 2) {
    return null;
  }

  const { data } = await searchApi.get('/', {
    params: {
      q: query.trim(),
      type,
      page,
      limit,
    },
  });
  return data.data;
};

export default searchApi;
