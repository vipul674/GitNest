import { createApiClient } from './createApiClient.js';
import { API_BASE_URL } from '../utils/apiConfig.js';

const architectureApi = createApiClient(`${API_BASE_URL}/architecture`);

export const analyzeRepo = async (owner, repo) => {
  const response = await architectureApi.get(`/${owner}/${repo}`);
  return response.data.data;
};

export default architectureApi;