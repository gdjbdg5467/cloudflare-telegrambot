// === 配置变量（从 env 中获取）=== 
let TOKEN = null
let WEBHOOK = '/endpoint'
let SECRET = null
let ADMIN_UID = null
let ADMIN_GROUP_ID = null
let WELCOME_MESSAGE = '欢迎使用机器人'
let MESSAGE_INTERVAL = 1
let DELETE_TOPIC_AS_BAN = false
let ENABLE_VERIFICATION = false
let VERIFICATION_MAX_ATTEMPTS = 10
let TARGET_FORWARD_ID = '' // 新增：目标转发ID

// 初始化配置变量
function initConfig(env) {
  TOKEN = env.ENV_BOT_TOKEN
  SECRET = env.ENV_BOT_SECRET
  ADMIN_UID = env.ENV_ADMIN_UID
  ADMIN_GROUP_ID = env.ENV_ADMIN_GROUP_ID
  WELCOME_MESSAGE = env.ENV_WELCOME_MESSAGE || '欢迎使用机器人'
  MESSAGE_INTERVAL = env.ENV_MESSAGE_INTERVAL ? parseInt(env.ENV_MESSAGE_INTERVAL) || 1 : 1
  DELETE_TOPIC_AS_BAN = (env.ENV_DELETE_TOPIC_AS_BAN || '').toLowerCase() === 'true'
  ENABLE_VERIFICATION = (env.ENV_ENABLE_VERIFICATION || '').toLowerCase() === 'true'
  VERIFICATION_MAX_ATTEMPTS = env.ENV_VERIFICATION_MAX_ATTEMPTS ? parseInt(env.ENV_VERIFICATION_MAX_ATTEMPTS) || 10 : 10
  // 新增：初始化转发目标ID
  TARGET_FORWARD_ID = env.ENV_TARGET_FORWARD_ID || ''
}

/**
 * Telegram API 请求封装
 */
function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function editMessage(msg = {}) {
  return requestTelegram('editMessageText', makeReqBody(msg))
}

function editMessageCaption(msg = {}) {
  return requestTelegram('editMessageCaption', makeReqBody(msg))
}

function deleteMessage(chat_id, message_id) {
  return requestTelegram('deleteMessage', makeReqBody({
    chat_id: chat_id,
    message_id: message_id
  }))
}

function deleteMessages(chat_id, message_ids) {
  return requestTelegram('deleteMessages', makeReqBody({
    chat_id: chat_id,
    message_ids: message_ids
  }))
}

function createForumTopic(chat_id, name) {
  return requestTelegram('createForumTopic', makeReqBody({
    chat_id: chat_id,
    name: name
  }))
}

function deleteForumTopic(chat_id, message_thread_id) {
  return requestTelegram('deleteForumTopic', makeReqBody({
    chat_id: chat_id,
    message_thread_id: message_thread_id
  }))
}

function getUserProfilePhotos(user_id, limit = 1) {
  return requestTelegram('getUserProfilePhotos', null, {
    user_id: user_id,
    limit: limit
  })
}

function sendPhoto(msg = {}) {
  return requestTelegram('sendPhoto', makeReqBody(msg))
}

// 新增：转发消息函数
function forwardMessage(msg = {}) {
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * 验证码缓存管理（使用 Cache API）
 */
class VerificationCache {
  constructor() {
    this.cacheName = 'verification-cache'
  }

  // 生成缓存键对应的 URL
  _getCacheUrl(user_id, key) {
    return `https://internal.cache/${user_id}/${key}`
  }

  // 获取验证码数据
  async getVerification(user_id, key) {
    try {
      const cache = await caches.open(this.cacheName)
      const cacheUrl = this._getCacheUrl(user_id, key)
      const response = await cache.match(cacheUrl)
      
      if (!response) {
        return null
      }

      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error getting verification from cache:', error)
      return null
    }
  }

  // 设置验证码数据（带过期时间）
  async setVerification(user_id, key, value, expirationSeconds = null) {
    try {
      const cache = await caches.open(this.cacheName)
      const cacheUrl = this._getCacheUrl(user_id, key)
      
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': expirationSeconds 
          ? `max-age=${expirationSeconds}` 
          : 'max-age=86400' // 默认24小时
      })

      const response = new Response(JSON.stringify(value), { headers })
      await cache.put(cacheUrl, response)
      
      return true
    } catch (error) {
      console.error('Error setting verification in cache:', error)
      return false
    }
  }

  // 删除验证码数据
  async deleteVerification(user_id, key) {
    try {
      const cache = await caches.open(this.cacheName)
      const cacheUrl = this._getCacheUrl(user_id, key)
      await cache.delete(cacheUrl)
      return true
    } catch (error) {
      console.error('Error deleting verification from cache:', error)
      return false
    }
  }
}

/**
 * 数据库操作封装 (使用 D1 数据库)
 */
class Database {
  constructor(d1) {
    this.d1 = d1
  }

  // 用户相关
  async getUser(user_id) {
    const result = await this.d1.prepare(
      'SELECT * FROM users WHERE user_id = ?'
    ).bind(user_id.toString()).first()
    
    if (!result) return null
    
    return {
      user_id: result.user_id,
      first_name: result.first_name,
      last_name: result.last_name,
      username: result.username,
      message_thread_id: result.message_thread_id,
      created_at: result.created_at,
      updated_at: result.updated_at
    }
  }

  async setUser(user_id, userData) {
    await this.d1.prepare(
      `INSERT OR REPLACE INTO users 
       (user_id, first_name, last_name, username, message_thread_id, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user_id.toString(),
      userData.first_name || null,
      userData.last_name || null,
      userData.username || null,
      userData.message_thread_id || null,
      userData.created_at || Date.now(),
      userData.updated_at || Date.now()
    ).run()
  }

  async getAllUsers() {
    const result = await this.d1.prepare(
      'SELECT * FROM users'
    ).all()
    return result.results || []
  }

  // 消息映射相关
  async getMessageMap(key) {
    const result = await this.d1.prepare(
      'SELECT mapped_value FROM message_mappings WHERE mapping_key = ?'
    ).bind(key).first()
    return result?.mapped_value || null
  }

  async setMessageMap(key, value) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO message_mappings (mapping_key, mapped_value, created_at) VALUES (?, ?, ?)'
    ).bind(key, value || null, Date.now()).run()
  }

  // 话题状态相关
  async getTopicStatus(thread_id) {
    const result = await this.d1.prepare(
      'SELECT status, updated_at FROM topic_status WHERE thread_id = ?'
    ).bind(thread_id).first()
    return result || { status: 'opened' }
  }

  async setTopicStatus(thread_id, status) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO topic_status (thread_id, status, updated_at) VALUES (?, ?, ?)'
    ).bind(thread_id || null, status || 'opened', Date.now()).run()
  }

  // 用户状态相关（非验证码）
  async getUserState(user_id, key) {
    const result = await this.d1.prepare(
      'SELECT state_value, expiry_time FROM user_states WHERE user_id = ? AND state_key = ?'
    ).bind(user_id.toString(), key).first()
    
    if (!result) return null
    
    // 检查是否过期
    if (result.expiry_time && Date.now() > result.expiry_time) {
      await this.deleteUserState(user_id, key)
      return null
    }
    
    return JSON.parse(result.state_value)
  }

  async setUserState(user_id, key, value, expirationTtl = null) {
    const expiryTime = expirationTtl ? Date.now() + (expirationTtl * 1000) : null
    await this.d1.prepare(
      'INSERT OR REPLACE INTO user_states (user_id, state_key, state_value, expiry_time) VALUES (?, ?, ?, ?)'
    ).bind(user_id.toString(), key || 'unknown', JSON.stringify(value), expiryTime).run()
  }

  async deleteUserState(user_id, key) {
    await this.d1.prepare(
      'DELETE FROM user_states WHERE user_id = ? AND state_key = ?'
    ).bind(user_id.toString(), key).run()
  }

  // 屏蔽用户相关
  async isUserBlocked(user_id) {
    const result = await this.d1.prepare(
      'SELECT blocked FROM blocked_users WHERE user_id = ?'
    ).bind(user_id.toString()).first()
    return result?.blocked === 1 || false
  }

  async blockUser(user_id, blocked = true) {
    if (blocked) {
      await this.d1.prepare(
        'INSERT OR REPLACE INTO blocked_users (user_id, blocked, blocked_at) VALUES (?, ?, ?)'
      ).bind(user_id.toString(), 1, Date.now()).run()
    } else {
      await this.d1.prepare(
        'DELETE FROM blocked_users WHERE user_id = ?'
      ).bind(user_id.toString()).run()
    }
  }

  // 消息频率限制
  async getLastMessageTime(user_id) {
    const result = await this.d1.prepare(
      'SELECT last_message_time FROM message_rates WHERE user_id = ?'
    ).bind(user_id.toString()).first()
    return result?.last_message_time || 0
  }

  async setLastMessageTime(user_id, timestamp) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO message_rates (user_id, last_message_time) VALUES (?, ?)'
    ).bind(user_id.toString(), timestamp || Date.now()).run()
  }

  // 清理过期数据（定期调用）
  async cleanupExpiredStates() {
    const now = Date.now()
    await this.d1.prepare(
      'DELETE FROM user_states WHERE expiry_time IS NOT NULL AND expiry_time < ?'
    ).bind(now).run()
  }

  // 删除用户的所有消息映射
  async deleteUserMessageMappings(user_id) {
    await this.d1.prepare(
      'DELETE FROM message_mappings WHERE mapping_key LIKE ?'
    ).bind(`u2a:${user_id}:%`).run()
  }

  // 新增：源频道管理相关
  async getSourceChannels() {
    const result = await this.d1.prepare(
      'SELECT * FROM source_channels'
    ).all()
    return result.results || []
  }

  async addSourceChannel(channelId, username, link) {
    await this.d1.prepare(
      `INSERT OR IGNORE INTO source_channels 
       (channel_id, username, link, added_at) 
       VALUES (?, ?, ?, ?)`
    ).bind(
      channelId,
      username,
      link,
      Date.now()
    ).run()
  }

  async removeSourceChannel(channelId) {
    await this.d1.prepare(
      'DELETE FROM source_channels WHERE channel_id = ?'
    ).bind(channelId).run()
  }

  async isSourceChannel(channelId) {
    const result = await this.d1.prepare(
      'SELECT id FROM source_channels WHERE channel_id = ?'
    ).bind(channelId).first()
    return !!result
  }
}

let db = null
const verificationCache = new VerificationCache()

/**
 * 工具函数
 */
function mentionHtml(user_id, name) {
  return `<a href="tg://user?id=${user_id}">${escapeHtml(name)}</a>`
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#39;')
}

function randomString(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 新增：解析频道ID工具函数
async function resolveChannelId(input) {
  try {
    let username;
    if (input.startsWith('http')) {
      username = new URL(input).pathname.replace('/', '');
    } else if (input.startsWith('@')) {
      username = input.slice(1);
    } else {
      username = input;
    }

    const response = await fetch(apiUrl('getChat', { chat_id: `@${username}` }));
    const data = await response.json();
    return data.ok ? data.result.id.toString() : null;
  } catch (error) {
    console.error("Channel resolution error:", error);
    return null;
  }
}

// 新增：转发频道消息处理函数
async function handleChannelPost(message) {
  if (!TARGET_FORWARD_ID) return;
  
  const sourceChannelId = message.chat.id.toString();
  if (!await db.isSourceChannel(sourceChannelId)) return;

  try {
    await forwardMessage({
      chat_id: TARGET_FORWARD_ID,
      from_chat_id: sourceChannelId,
      message_id: message.message_id
    });
    console.log(`Forwarded message from ${sourceChannelId} to ${TARGET_FORWARD_ID}`);
  } catch (error) {
    console.error("Forward error:", error);
  }
}

// 新增：管理员命令处理函数
async function handleAdminCommands(message) {
  const text = message.text || '';
  const chatId = message.chat.id;
  const userId = message.from.id.toString();

  // 仅允许管理员操作
  if (userId !== ADMIN_UID) return;

  // 添加源频道
  if (text.startsWith('/addsource')) {
    const input = text.split(' ')[1];
    if (!input) {
      return sendMessage({ chat_id: chatId, text: '请提供频道链接或用户名（如 /addsource @example）' });
    }

    const channelId = await resolveChannelId(input);
    if (!channelId) {
      return sendMessage({ chat_id: chatId, text: '解析频道失败，请确保机器人已加入该频道' });
    }

    await db.addSourceChannel(
      channelId,
      input.startsWith('@') ? input : null,
      input.startsWith('http') ? input : null
    );

    return sendMessage({ chat_id: chatId, text: `已添加源频道（ID: ${channelId}）` });
  }

  // 删除源频道
  if (text.startsWith('/removesource')) {
    const input = text.split(' ')[1];
    if (!input) {
      return sendMessage({ chat_id: chatId, text: '请提供频道链接或用户名（如 /removesource @example）' });
    }

    const channelId = await resolveChannelId(input);
    if (!channelId) {
      return sendMessage({ chat_id: chatId, text: '解析频道失败' });
    }

    await db.removeSourceChannel(channelId);
    return sendMessage({ chat_id: chatId, text: `已删除源频道（ID: ${channelId}）` });
  }

  // 列出源频道
  if (text.startsWith('/listsources')) {
    const channels = await db.getSourceChannels();
    if (channels.length === 0) {
      return sendMessage({ chat_id: chatId, text: '当前没有配置源频道' });
    }

    let messageText = '当前源频道列表：\n';
    channels.forEach(channel => {
      messageText += `- ID: ${channel.channel_id}\n`;
      if (channel.username) messageText += `  用户名: ${channel.username}\n`;
      if (channel.link) messageText += `  链接: ${channel.link}\n`;
    });

    return sendMessage({ chat_id: chatId, text: messageText });
  }
}

// 新增：数据库初始化函数
async function initDatabase(request, env) {
  try {
    // 初始化用户表（如果不存在）
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        message_thread_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `).run();

    // 初始化消息映射表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS message_mappings (
        mapping_key TEXT PRIMARY KEY,
        mapped_value TEXT,
        created_at INTEGER
      )
    `).run();

    // 初始化话题状态表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS topic_status (
        thread_id INTEGER PRIMARY KEY,
        status TEXT,
        updated_at INTEGER
      )
    `).run();

    // 初始化用户状态表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT,
        state_key TEXT,
        state_value TEXT,
        expiry_time INTEGER,
        PRIMARY KEY (user_id, state_key)
      )
    `).run();

    // 初始化屏蔽用户表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        user_id TEXT PRIMARY KEY,
        blocked INTEGER,
        blocked_at INTEGER
      )
    `).run();

    // 初始化消息频率表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS message_rates (
        user_id TEXT PRIMARY KEY,
        last_message_time INTEGER
      )
    `).run();

    // 新增：初始化源频道表
    await env.D1.prepare(`
      CREATE TABLE IF NOT EXISTS source_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        username TEXT,
        link TEXT,
        added_at INTEGER,
        UNIQUE(channel_id)
      )
    `).run();

    // 从环境变量导入默认频道
    if (env.ENV_DEFAULT_SOURCE_CHANNELS) {
      const channels = env.ENV_DEFAULT_SOURCE_CHANNELS.split(',').map(c => c.trim());
      for (const channel of channels) {
        const channelId = await resolveChannelId(channel);
        if (channelId) {
          await env.D1.prepare(`
            INSERT OR IGNORE INTO source_channels (channel_id, username, link, added_at)
            VALUES (?, ?, ?, ?)
          `).bind(
            channelId,
            channel.startsWith('@') ? channel : null,
            channel.startsWith('http') ? channel : null,
            Date.now()
          ).run();
        }
      }
    }

    return new Response("✅ 数据库表初始化成功");
  } catch (error) {
    console.error("数据库初始化错误:", error);
    return new Response("❌ 数据库初始化失败", { status: 500 });
  }
}

// 新增：注册Webhook函数
async function registerWebhook(env) {
  const webhookUrl = new URL(request.url).origin + WEBHOOK;
  const response = await requestTelegram('setWebhook', null, {
    url: webhookUrl,
    secret_token: SECRET
  });
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 新增：更新处理函数
async function onUpdate(update, env) {
  try {
    db = new Database(env.D1);
    
    // 处理频道消息
    if (update.channel_post) {
      await handleChannelPost(update.channel_post);
      return;
    }

    // 处理编辑的频道消息
    if (update.edited_channel_post) {
      await handleChannelPost(update.edited_channel_post);
      return;
    }

    // 处理普通消息
    const message = update.message;
    if (message) {
      // 处理管理员命令
      if (message.text && message.text.startsWith('/')) {
        await handleAdminCommands(message);
      }
      // 这里可以添加原有消息处理逻辑
    }
  } catch (error) {
    console.error('更新处理错误:', error);
  }
}

// 主入口函数
export default {
  async fetch(request, env) {
    initConfig(env);
    db = new Database(env.D1);

    const url = new URL(request.url);
    
    // 数据库初始化端点
    if (url.pathname === '/initDatabase') {
      return initDatabase(request, env);
    }
    
    // Webhook注册端点
    if (url.pathname === '/registerWebhook') {
      return registerWebhook(env);
    }

    // 处理Telegram回调
    if (request.method === 'POST' && url.pathname === WEBHOOK) {
      // 验证secret
      if (SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
        return new Response('Unauthorized', { status: 403 });
      }

      const update = await request.json();
      await onUpdate(update, env);
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }
};
