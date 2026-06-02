import { createApiClient } from './createApiClient.js';
import { API_BASE_URL } from '../utils/apiConfig.js';

const auditLogApi = createApiClient(`${API_BASE_URL}/repos`);

export const fetchAuditLogs = async ({
  username,
  reponame,
  page = 1,
  limit = 20,
  filters = {},
}) => {
  const params = {
    page,
    limit,
  };

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value;
    }
  }

  const response = await auditLogApi.get(`/${username}/${reponame}/audit-logs`, {
    params,
  });

  return response.data;
};

export default auditLogApi;
