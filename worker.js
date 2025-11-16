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

  // 安全执行SQL的方法，处理可能的undefined结果
  async safeRun(query, params = []) {
    try {
      const result = await this.d1.prepare(query).bind(...params).run()
      // 处理可能的undefined结果，确保返回对象
      return result || { success: true }
    } catch (error) {
      console.error('Database error:', error)
      throw error
    }
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
    return this.safeRun(
      `INSERT OR REPLACE INTO users 
       (user_id, first_name, last_name, username, message_thread_id, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id.toString(),
        userData.first_name || null,
        userData.last_name || null,
        userData.username || null,
        userData.message_thread_id || null,
        userData.created_at || Date.now(),
        userData.updated_at || Date.now()
      ]
    )
  }

  async getAllUsers() {
    const result = await this.d1.prepare(
      'SELECT * FROM users'
    ).all()
    return result?.results || []
  }

  // 消息映射相关
  async getMessageMap(key) {
    const result = await this.d1.prepare(
      'SELECT mapped_value FROM message_mappings WHERE mapping_key = ?'
    ).bind(key).first()
    return result?.mapped_value || null
  }

  async setMessageMap(key, value) {
    return this.safeRun(
      'INSERT OR REPLACE INTO message_mappings (mapping_key, mapped_value, created_at) VALUES (?, ?, ?)',
      [key, value || null, Date.now()]
    )
  }

  // 话题状态相关
  async getTopicStatus(thread_id) {
    const result = await this.d1.prepare(
      'SELECT status, updated_at FROM topic_status WHERE thread_id = ?'
    ).bind(thread_id).first()
    return result || { status: 'opened' }
  }

  async setTopicStatus(thread_id, status) {
    return this.safeRun(
      'INSERT OR REPLACE INTO topic_status (thread_id, status, updated_at) VALUES (?, ?, ?)',
      [thread_id || null, status || 'opened', Date.now()]
    )
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
    return this.safeRun(
      'INSERT OR REPLACE INTO user_states (user_id, state_key, state_value, expiry_time) VALUES (?, ?, ?, ?)',
      [user_id.toString(), key || 'unknown', JSON.stringify(value), expiryTime]
    )
  }

  async deleteUserState(user_id, key) {
    return this.safeRun(
      'DELETE FROM user_states WHERE user_id = ? AND state_key = ?',
      [user_id.toString(), key]
    )
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
      return this.safeRun(
        'INSERT OR REPLACE INTO blocked_users (user_id, blocked, blocked_at) VALUES (?, ?, ?)',
        [user_id.toString(), 1, Date.now()]
      )
    } else {
      return this.safeRun(
        'DELETE FROM blocked_users WHERE user_id = ?',
        [user_id.toString()]
      )
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
    return this.safeRun(
      'INSERT OR REPLACE INTO message_rates (user_id, last_message_time) VALUES (?, ?)',
      [user_id.toString(), timestamp || Date.now()]
    )
  }

  // 清理过期数据（定期调用）
  async cleanupExpiredStates() {
    const now = Date.now()
    return this.safeRun(
      'DELETE FROM user_states WHERE expiry_time IS NOT NULL AND expiry_time < ?',
      [now]
    )
  }

  // 删除用户的所有消息映射
  async deleteUserMessageMappings(user_id) {
    return this.safeRun(
      'DELETE FROM message_mappings WHERE mapping_key LIKE ?',
      [`u2a:${user_id}:%`]
    )
  }

  // 初始化数据库表结构
  async initTables() {
    // 创建用户表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        message_thread_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    // 创建消息映射表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS message_mappings (
        mapping_key TEXT PRIMARY KEY,
        mapped_value TEXT,
        created_at INTEGER
      )
    `);

    // 创建话题状态表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS topic_status (
        thread_id INTEGER PRIMARY KEY,
        status TEXT,
        updated_at INTEGER
      )
    `);

    // 创建用户状态表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT,
        state_key TEXT,
        state_value TEXT,
        expiry_time INTEGER,
        PRIMARY KEY (user_id, state_key)
      )
    `);

    // 创建封禁用户表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        user_id TEXT PRIMARY KEY,
        blocked INTEGER,
        blocked_at INTEGER
      )
    `);

    // 创建消息频率限制表
    await this.safeRun(`
      CREATE TABLE IF NOT EXISTS message_rates (
        user_id TEXT PRIMARY KEY,
        last_message_time INTEGER
      )
    `);

    return true;
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

/**
 * 主处理函数
 */
export default {
  async fetch(request, env, ctx) {
    initConfig(env)
    db = new Database(env.D1)
    
    const url = new URL(request.url)
    
    // 数据库初始化端点
    if (url.pathname === '/initDatabase') {
      try {
        await db.initTables()
        return new Response('✅ Database tables initialized successfully', {
          headers: { 'Content-Type': 'text/plain' }
        })
      } catch (error) {
        console.error('Database initialization error:', error)
        return new Response(`❌ 数据库初始化失败: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    }
    
    // Webhook注册端点
    if (url.pathname === '/registerWebhook') {
      try {
        const webhookUrl = `${url.origin}${WEBHOOK}?secret=${SECRET}`
        const response = await requestTelegram('setWebhook', null, {
          url: webhookUrl,
          secret_token: SECRET
        })
        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (error) {
        return new Response(`❌ Webhook注册失败: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    }
    
    // Telegram Webhook处理端点
    if (url.pathname === WEBHOOK && url.searchParams.get('secret') === SECRET) {
      try {
        const update = await request.json()
        await handleUpdate(update)
        return new Response('OK')
      } catch (error) {
        console.error('Webhook handling error:', error)
        return new Response('Error', { status: 500 })
      }
    }
    
    return new Response('Not found', { status: 404 })
  }
}

/**
 * 处理Telegram更新
 */
async function handleUpdate(update) {
  // 这里是消息处理逻辑，根据需要实现
  if (update.message) {
    await handleMessage(update.message)
  }
  // 可以添加其他类型更新的处理逻辑
}

/**
 * 处理消息
 */
async function handleMessage(message) {
  // 消息处理具体实现
  const chatId = message.chat.id
  const userId = message.from.id
  
  // 检查用户是否被封禁
  if (await db.isUserBlocked(userId)) {
    return
  }
  
  // 简单的欢迎消息示例
  if (message.text === '/start') {
    await sendMessage({
      chat_id: chatId,
      text: WELCOME_MESSAGE
    })
  }
}
