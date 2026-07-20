import http from '@/axios/index.js';
export const forumConfig = () => http.get('/forum/config'); export const saveForumConfig = data => http.put('/forum/config', data);
export const forumRoutes = () => http.get('/forum/routes'); export const saveForumRoute = data => http.put('/forum/routes', data); export const deleteForumRoute = id => http.delete(`/forum/routes/${id}`);
export const forumZones = () => http.get('/forum/zones'); export const saveForumZone = data => http.put('/forum/zones', data); export const deleteForumZone = id => http.delete(`/forum/zones/${id}`);
export const testForumTopic = data => http.post('/forum/test', data); export const spamRules = () => http.get('/spam/rules'); export const saveSpamRule = data => http.put('/spam/rules', data); export const deleteSpamRule = id => http.delete(`/spam/rules/${id}`);
