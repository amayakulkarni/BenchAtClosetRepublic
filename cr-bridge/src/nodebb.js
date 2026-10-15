// NodeBB Write API (v3) client using a master token. Every call is made as the bridge's own
// forum account (CR_BRIDGE_UID), which must be an administrator for group changes.
import { config } from './config.js';
import { audit } from './db.js';

export class NodebbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  const { url, token, bridgeUid } = config.nodebb;
  const target = new URL(`${url}${path}`);
  const init = { method, headers: { authorization: `Bearer ${token}` } };
  if (method === 'GET' || method === 'HEAD') {
    target.searchParams.set('_uid', String(bridgeUid));
  } else {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify({ _uid: bridgeUid, ...(body || {}) });
  }
  const res = await fetch(target, init);
  if (method === 'HEAD') return res.ok;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new NodebbError(res.status, `NodeBB ${method} ${path}: ${res.status} ${json?.status?.message || ''}`.trim());
  return json.response ?? json;
}

// Writes go through here so CR_DRY_RUN can log them instead.
async function write(action, method, path, body) {
  if (config.dryRun) {
    audit(`dry-run:${action}`, { method, path, body });
    return { dryRun: true };
  }
  return call(method, path, body);
}

export const nodebb = {
  getTopic: (tid) => call('GET', `/api/v3/topics/${tid}`),
  getPost: (pid) => call('GET', `/api/v3/posts/${pid}`),
  getRawPost: (pid) => call('GET', `/api/v3/posts/${pid}/raw`),
  getUser: (uid) => call('GET', `/api/v3/users/${uid}`),
  async uidByEmail(email) {
    try {
      const res = await call('GET', `/api/user/email/${encodeURIComponent(email)}`);
      return res?.uid ? Number(res.uid) : null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  },
  async userEmail(uid) {
    // The emails list needs admin rights, which the bridge account has.
    try {
      const res = await call('GET', `/api/v3/users/${uid}/emails`);
      const list = Array.isArray(res) ? res : res?.emails || [];
      return list.length ? String(list[0]).toLowerCase() : null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  },

  createTopic: ({ cid, title, content, tags }) => write('topic.create', 'POST', '/api/v3/topics', { cid, title, content, tags }),
  reply: (tid, { content, toPid }) => write('topic.reply', 'POST', `/api/v3/topics/${tid}`, { content, toPid }),
  editPost: (pid, { content, title }) => write('post.edit', 'PUT', `/api/v3/posts/${pid}`, { content, title }),
  deleteTopic: (tid) => write('topic.delete', 'DELETE', `/api/v3/topics/${tid}/state`),
  restoreTopic: (tid) => write('topic.restore', 'PUT', `/api/v3/topics/${tid}/state`),
  lockTopic: (tid) => write('topic.lock', 'PUT', `/api/v3/topics/${tid}/lock`),
  deletePost: (pid) => write('post.delete', 'DELETE', `/api/v3/posts/${pid}/state`),
  restorePost: (pid) => write('post.restore', 'PUT', `/api/v3/posts/${pid}/state`),

  groupExists: (slug) => call('HEAD', `/api/v3/groups/${slug}`),
  createGroup: (data) => write('group.create', 'POST', '/api/v3/groups', data),
  updateGroup: (slug, data) => write('group.update', 'PUT', `/api/v3/groups/${slug}`, data),
  joinGroup: (slug, uid) => write('group.join', 'PUT', `/api/v3/groups/${slug}/membership/${uid}`),
  leaveGroup: (slug, uid) => write('group.leave', 'DELETE', `/api/v3/groups/${slug}/membership/${uid}`),
  setGroupTitle: (uid, groupName) =>
    write('user.groupTitle', 'PUT', `/api/v3/users/${uid}`, { groupTitle: groupName ? JSON.stringify([groupName]) : '' }),
};
