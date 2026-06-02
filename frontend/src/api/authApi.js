import { createApiClient } from "./createApiClient.js";
import { API_BASE_URL } from "../utils/apiConfig.js";

const authApi = createApiClient(`${API_BASE_URL}/auth`);

export const registerUser = async (userData) => {
  const response = await authApi.post("/register", userData);
  return response.data;
};

export const loginUser = async (userData) => {
  const response = await authApi.post("/login", userData);
  return response.data;
};

export const getMe = async () => {
  const response = await authApi.get('/me'); 
  return response.data.data;
};

export const updateUserProfile = async (profileData) => {
  const response = await createApiClient(`${API_BASE_URL}/users`).put("/profile", profileData);
  return response.data.data;
};

export default authApi;
